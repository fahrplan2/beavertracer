//@ts-check
import { EthernetPort } from "./EthernetPort.js";

/**
 * Wireless variant of EthernetPort.
 * Never has a physical linkref; always reports as linked.
 * Managed by WifiMedium instead of EthernetLink.
 */
export class WirelessPort extends EthernetPort {
    isLinked() { return true; }
    isFree()   { return false; }
}
