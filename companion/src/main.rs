use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use rand::Rng;
use socket2::{Domain, Protocol, Socket, Type};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream, UdpSocket};
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::accept_async;
use tungstenite::Message;

static VERBOSE: AtomicBool = AtomicBool::new(false);

macro_rules! vlog {
    ($($arg:tt)*) => {
        if VERBOSE.load(Ordering::Relaxed) { eprintln!($($arg)*); }
    };
}

// ── Debug helpers ────────────────────────────────────────────────────────────

fn debug_ascii(label: &str, data: &[u8]) {
    if !VERBOSE.load(Ordering::Relaxed) { return; }
    const SHOW: usize = 512;
    let slice = &data[..data.len().min(SHOW)];
    let text: String = slice.iter().map(|&b| {
        if b == b'\r' { '↵' }
        else if b == b'\n' { '\n' }
        else if b >= 0x20 && b < 0x7f { b as char }
        else { '·' }
    }).collect();
    eprint!("{label} ({} B):\n", data.len());
    for line in text.lines() { eprintln!("    {line}"); }
    if data.len() > SHOW { eprintln!("    … (+{} B)", data.len() - SHOW); }
}

// ── Packet building ──────────────────────────────────────────────────────────

fn ip_checksum(buf: &[u8]) -> u16 {
    let mut sum: u32 = 0;
    let mut i = 0;
    while i + 1 < buf.len() {
        sum += u16::from_be_bytes([buf[i], buf[i + 1]]) as u32;
        i += 2;
    }
    if i < buf.len() { sum += (buf[i] as u32) << 8; }
    while sum >> 16 != 0 { sum = (sum & 0xffff) + (sum >> 16); }
    !(sum as u16)
}

fn tcp_checksum(src: Ipv4Addr, dst: Ipv4Addr, tcp: &[u8]) -> u16 {
    let tcp_len = tcp.len();
    let mut pseudo = vec![0u8; 12 + tcp_len];
    pseudo[0..4].copy_from_slice(&src.octets());
    pseudo[4..8].copy_from_slice(&dst.octets());
    pseudo[9] = 6;
    pseudo[10..12].copy_from_slice(&(tcp_len as u16).to_be_bytes());
    pseudo[12..].copy_from_slice(tcp);
    ip_checksum(&pseudo)
}

fn build_ipv4_header(src: Ipv4Addr, dst: Ipv4Addr, proto: u8, total_len: usize) -> [u8; 20] {
    let mut h = [0u8; 20];
    h[0] = 0x45;
    h[2..4].copy_from_slice(&(total_len as u16).to_be_bytes());
    h[8] = 64;
    h[9] = proto;
    h[12..16].copy_from_slice(&src.octets());
    h[16..20].copy_from_slice(&dst.octets());
    let csum = ip_checksum(&h);
    h[10..12].copy_from_slice(&csum.to_be_bytes());
    h
}

fn build_ipv4_udp(src: Ipv4Addr, src_port: u16, dst: Ipv4Addr, dst_port: u16, payload: &[u8]) -> Vec<u8> {
    let udp_len = 8 + payload.len();
    let mut pkt = vec![0u8; 20 + udp_len];
    pkt[0..20].copy_from_slice(&build_ipv4_header(src, dst, 17, 20 + udp_len));
    pkt[20..22].copy_from_slice(&src_port.to_be_bytes());
    pkt[22..24].copy_from_slice(&dst_port.to_be_bytes());
    pkt[24..26].copy_from_slice(&(udp_len as u16).to_be_bytes());
    pkt[28..].copy_from_slice(payload);
    pkt
}

fn build_ipv4_icmp(src: Ipv4Addr, dst: Ipv4Addr, icmp: &[u8]) -> Vec<u8> {
    let mut pkt = vec![0u8; 20 + icmp.len()];
    pkt[0..20].copy_from_slice(&build_ipv4_header(src, dst, 1, 20 + icmp.len()));
    pkt[20..].copy_from_slice(icmp);
    pkt
}

/// Flags: SYN=0x02, ACK=0x10, PSH=0x08, FIN=0x01, RST=0x04
fn build_ipv4_tcp(
    src: Ipv4Addr, src_port: u16,
    dst: Ipv4Addr, dst_port: u16,
    seq: u32, ack: u32,
    flags: u8,
    payload: &[u8],
) -> Vec<u8> {
    let tcp_len = 20 + payload.len();
    let total = 20 + tcp_len;
    let mut pkt = vec![0u8; total];
    pkt[0..20].copy_from_slice(&build_ipv4_header(src, dst, 6, total));
    pkt[20..22].copy_from_slice(&src_port.to_be_bytes());
    pkt[22..24].copy_from_slice(&dst_port.to_be_bytes());
    pkt[24..28].copy_from_slice(&seq.to_be_bytes());
    pkt[28..32].copy_from_slice(&ack.to_be_bytes());
    pkt[32] = 0x50; // data offset = 5 (20 bytes)
    pkt[33] = flags;
    pkt[34..36].copy_from_slice(&65535u16.to_be_bytes()); // window
    if !payload.is_empty() { pkt[40..].copy_from_slice(payload); }
    let csum = tcp_checksum(src, dst, &pkt[20..]);
    pkt[36..38].copy_from_slice(&csum.to_be_bytes());
    pkt
}

// ── TCP connection table ─────────────────────────────────────────────────────

type ConnKey = (Ipv4Addr, u16, Ipv4Addr, u16); // (sim_src_ip, sim_src_port, dst_ip, dst_port)

struct TcpConn {
    to_real: mpsc::Sender<Vec<u8>>,
    our_seq: u32,
    their_seq: u32,
}

type ConnTable = Arc<Mutex<HashMap<ConnKey, TcpConn>>>;

// ── Protocol handlers ────────────────────────────────────────────────────────

async fn handle_udp(bytes: Vec<u8>, ihl: usize, src_ip: Ipv4Addr, dst_ip: Ipv4Addr, tx: WsTx) {
    if bytes.len() < ihl + 8 { return; }
    let ttl      = bytes[8];
    let ip_total = u16::from_be_bytes([bytes[2], bytes[3]]) as usize;
    let ip_end   = ip_total.min(bytes.len());
    let src_port = u16::from_be_bytes([bytes[ihl],     bytes[ihl + 1]]);
    let dst_port = u16::from_be_bytes([bytes[ihl + 2], bytes[ihl + 3]]);
    let payload  = bytes[ihl + 8..ip_end].to_vec();

    vlog!("[UDP] {src_ip}:{src_port} → {dst_ip}:{dst_port} TTL={ttl} ({} B)", payload.len());

    let Ok(sock) = UdpSocket::bind("0.0.0.0:0").await else { return; };
    sock.set_ttl(ttl as u32).ok();
    if sock.send_to(&payload, (dst_ip, dst_port)).await.is_err() { return; }

    let mut buf = vec![0u8; 65535];
    let result = tokio::time::timeout(Duration::from_secs(5), sock.recv_from(&mut buf)).await;

    if let Ok(Ok((n, from))) = result {
        let from_ip = match from.ip() { std::net::IpAddr::V4(ip) => ip, _ => return };
        vlog!("[UDP] ← {from} ({n} B)");
        let pkt = build_ipv4_udp(from_ip, from.port(), src_ip, src_port, &buf[..n]);
        tx.lock().await.send(Message::Binary(pkt)).await.ok();
    }
}

async fn handle_icmp(bytes: Vec<u8>, ihl: usize, src_ip: Ipv4Addr, dst_ip: Ipv4Addr, tx: WsTx) {
    if bytes.len() < ihl + 8 { return; }
    let ttl  = bytes[8];
    let icmp = &bytes[ihl..];
    if icmp[0] != 8 { return; } // only echo request

    vlog!("[ICMP] {src_ip} → {dst_ip} TTL={ttl} ping");

    let Ok(sock) = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::ICMPV4)) else {
        eprintln!("[ICMP] socket() failed — try sudo?");
        return;
    };
    sock.set_ttl(ttl as u32).ok();
    sock.set_read_timeout(Some(Duration::from_secs(5))).ok();

    let dst = socket2::SockAddr::from(SocketAddrV4::new(dst_ip, 0));
    if sock.send_to(icmp, &dst).is_err() { return; }

    let mut buf = vec![std::mem::MaybeUninit::uninit(); 65535];
    let Ok((n, from)) = sock.recv_from(&mut buf) else { return; };

    let data: Vec<u8> = buf[..n].iter().map(|b| unsafe { b.assume_init() }).collect();
    let from_ip: Ipv4Addr = match from.as_socket_ipv4() { Some(a) => *a.ip(), None => return };

    // macOS may prepend an IP header to received ICMP data; strip it
    let icmp_resp = if data.len() >= 20 && (data[0] >> 4) == 4 {
        &data[((data[0] & 0xf) as usize) * 4..]
    } else {
        &data[..]
    };

    vlog!("[ICMP] ← {from_ip} ({} B)", icmp_resp.len());
    let pkt = build_ipv4_icmp(from_ip, src_ip, icmp_resp);
    tx.lock().await.send(Message::Binary(pkt)).await.ok();
}

async fn handle_tcp(bytes: Vec<u8>, ihl: usize, src_ip: Ipv4Addr, dst_ip: Ipv4Addr, tx: WsTx, conns: ConnTable) {
    const SYN: u8 = 0x02;
    const ACK: u8 = 0x10;
    const PSH: u8 = 0x08;
    const FIN: u8 = 0x01;
    const RST: u8 = 0x04;

    if bytes.len() < ihl + 20 { return; }
    let t        = ihl;
    let ip_total = u16::from_be_bytes([bytes[2], bytes[3]]) as usize;
    let ip_end   = ip_total.min(bytes.len());
    let src_port = u16::from_be_bytes([bytes[t],     bytes[t + 1]]);
    let dst_port = u16::from_be_bytes([bytes[t + 2], bytes[t + 3]]);
    let seq      = u32::from_be_bytes([bytes[t + 4], bytes[t + 5], bytes[t + 6], bytes[t + 7]]);
    let data_off = ((bytes[t + 12] >> 4) as usize) * 4;
    let flags    = bytes[t + 13];
    let payload  = bytes[(t + data_off)..ip_end].to_vec();

    let key: ConnKey = (src_ip, src_port, dst_ip, dst_port);

    if flags & SYN != 0 && flags & ACK == 0 {
        eprintln!("[TCP] {src_ip}:{src_port} → {dst_ip}:{dst_port} SYN");

        let stream = match TcpStream::connect((dst_ip, dst_port)).await {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[TCP] connect failed: {e}");
                let rst = build_ipv4_tcp(dst_ip, dst_port, src_ip, src_port, 0, seq + 1, RST | ACK, &[]);
                tx.lock().await.send(Message::Binary(rst)).await.ok();
                return;
            }
        };

        let our_isn      = rand::thread_rng().gen::<u32>();
        let their_next   = seq.wrapping_add(1);
        let our_seq_init = our_isn.wrapping_add(1);

        let syn_ack = build_ipv4_tcp(dst_ip, dst_port, src_ip, src_port, our_isn, their_next, SYN | ACK, &[]);
        tx.lock().await.send(Message::Binary(syn_ack)).await.ok();

        let (to_real_tx, mut to_real_rx) = mpsc::channel::<Vec<u8>>(64);
        let our_seq   = Arc::new(Mutex::new(our_seq_init));
        let their_seq = Arc::new(Mutex::new(their_next));
        let (mut real_rd, mut real_wr) = stream.into_split();

        // sim → real
        tokio::spawn(async move {
            while let Some(data) = to_real_rx.recv().await {
                if real_wr.write_all(&data).await.is_err() { break; }
            }
        });

        // real → sim
        {
            let tx2        = Arc::clone(&tx);
            let our_seq2   = Arc::clone(&our_seq);
            let their_seq2 = Arc::clone(&their_seq);
            let conns2     = Arc::clone(&conns);
            tokio::spawn(async move {
                let mut buf = vec![0u8; 65536];
                loop {
                    match real_rd.read(&mut buf).await {
                        Ok(0) => {
                            eprintln!("[TCP] {dst_ip}:{dst_port} closed");
                            let s   = *our_seq2.lock().await;
                            let a   = *their_seq2.lock().await;
                            let fin = build_ipv4_tcp(dst_ip, dst_port, src_ip, src_port, s, a, FIN | ACK, &[]);
                            tx2.lock().await.send(Message::Binary(fin)).await.ok();
                            conns2.lock().await.remove(&key);
                            break;
                        }
                        Ok(n) => {
                            let data = buf[..n].to_vec();
                            let mut s = our_seq2.lock().await;
                            let a     = *their_seq2.lock().await;
                            vlog!("[TCP] ← {dst_ip}:{dst_port} ({n} B)");
                            debug_ascii("    real→sim", &data);
                            let pkt = build_ipv4_tcp(dst_ip, dst_port, src_ip, src_port, *s, a, PSH | ACK, &data);
                            tx2.lock().await.send(Message::Binary(pkt)).await.ok();
                            *s = s.wrapping_add(n as u32);
                        }
                        Err(e) => {
                            eprintln!("[TCP] read error from {dst_ip}:{dst_port}: {e}");
                            conns2.lock().await.remove(&key);
                            break;
                        }
                    }
                }
            });
        }

        conns.lock().await.insert(key, TcpConn { to_real: to_real_tx, our_seq: our_seq_init, their_seq: their_next });

    } else if flags & (FIN | RST) != 0 {
        eprintln!("[TCP] {src_ip}:{src_port} FIN/RST");
        let mut table = conns.lock().await;
        if let Some(conn) = table.remove(&key) {
            let fin = build_ipv4_tcp(dst_ip, dst_port, src_ip, src_port, conn.our_seq, conn.their_seq.wrapping_add(1), FIN | ACK, &[]);
            tx.lock().await.send(Message::Binary(fin)).await.ok();
        }

    } else if !payload.is_empty() {
        let mut table = conns.lock().await;
        if let Some(conn) = table.get_mut(&key) {
            vlog!("[TCP] → {dst_ip}:{dst_port} ({} B)", payload.len());
            debug_ascii("    sim→real", &payload);
            conn.their_seq = conn.their_seq.wrapping_add(payload.len() as u32);
            let ack = build_ipv4_tcp(dst_ip, dst_port, src_ip, src_port, conn.our_seq, conn.their_seq, ACK, &[]);
            tx.lock().await.send(Message::Binary(ack)).await.ok();
            conn.to_real.send(payload).await.ok();
        }
    }
}

// ── WebSocket connection ─────────────────────────────────────────────────────

type WsTx = Arc<Mutex<futures_util::stream::SplitSink<
    tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
    Message,
>>>;

async fn handle_connection(stream: tokio::net::TcpStream, peer: SocketAddr) {
    eprintln!("[WS] connected {peer}");

    let ws = match accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => { eprintln!("[WS] handshake error: {e}"); return; }
    };

    let (tx_sink, mut rx) = ws.split();
    let tx: WsTx = Arc::new(Mutex::new(tx_sink));
    let conns: ConnTable = Arc::new(Mutex::new(HashMap::new()));

    while let Some(msg) = rx.next().await {
        match msg {
            Ok(Message::Binary(bytes)) => {
                if bytes.len() < 20 || bytes[0] >> 4 != 4 { continue; }
                let ihl    = ((bytes[0] & 0xf) as usize) * 4;
                let proto  = bytes[9];
                let src_ip = Ipv4Addr::new(bytes[12], bytes[13], bytes[14], bytes[15]);
                let dst_ip = Ipv4Addr::new(bytes[16], bytes[17], bytes[18], bytes[19]);
                match proto {
                    1  => tokio::spawn(handle_icmp(bytes, ihl, src_ip, dst_ip, Arc::clone(&tx))),
                    6  => tokio::spawn(handle_tcp(bytes, ihl, src_ip, dst_ip, Arc::clone(&tx), Arc::clone(&conns))),
                    17 => tokio::spawn(handle_udp(bytes, ihl, src_ip, dst_ip, Arc::clone(&tx))),
                    n  => { vlog!("[???] unknown protocol {n}"); continue; }
                };
            }
            Ok(Message::Close(_)) | Err(_) => break,
            _ => {}
        }
    }

    eprintln!("[WS] disconnected {peer}");
}

// ── Entry point ──────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    if std::env::args().any(|a| a == "--verbose" || a == "-v") {
        VERBOSE.store(true, Ordering::Relaxed);
        eprintln!("verbose mode on");
    }

    let addr = "127.0.0.1:12345";
    let listener = TcpListener::bind(addr).await
        .unwrap_or_else(|e| panic!("cannot bind {addr}: {e}"));

    eprintln!("networksim-companion on ws://{addr}  (UDP TCP ICMP)");

    while let Ok((stream, peer)) = listener.accept().await {
        tokio::spawn(handle_connection(stream, peer));
    }
}
