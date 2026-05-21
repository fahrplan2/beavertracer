{
  description = "Beaver Tracer - Interactive Network Simulator & Analyzer";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      supportedSystems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forEachSupportedSystem = f: nixpkgs.lib.genAttrs supportedSystems (system: f {
        pkgs = import nixpkgs { inherit system; };
      });
    in
    {
      packages = forEachSupportedSystem ({ pkgs }:
        let
          frontend = pkgs.buildNpmPackage {
            pname = "beavertracer-frontend";
            version = "0.1.12";
            src = ./.;

            npmDepsHash = "sha256-nGo/tloAX3hAkI1FprzkAaIztpyyy1Lk2L5wyh4ex5w=";

            buildPhase = ''
              npm run build
            '';

            installPhase = ''
              mkdir -p $out
              cp -r dist/* $out/
            '';
          };

          beavertracer = pkgs.rustPlatform.buildRustPackage {
            pname = "beavertracer";
            version = "0.1.12";
            src = ./.;

            setSourceRoot = "sourceRoot=$(echo */src-tauri)";

            cargoLock = {
              lockFile = ./src-tauri/Cargo.lock;
            };

            nativeBuildInputs = [
              pkgs.pkg-config
              pkgs.makeWrapper
            ];

            buildInputs = [
              pkgs.glib
              pkgs.gtk3
              pkgs.libsoup_3
              pkgs.webkitgtk_4_1
              pkgs.librsvg
              pkgs.openssl_3
              pkgs.dbus
            ];

            preBuild = ''
              chmod -R +w ..
              mkdir -p ../dist
              cp -r ${frontend}/* ../dist/
              export TAURI_SKIP_BEFORE_BUILD_COMMAND=true
            '';

            postInstall = ''
              wrapProgram $out/bin/beavertracer \
                --prefix LD_LIBRARY_PATH : "${pkgs.lib.makeLibraryPath [
                  pkgs.webkitgtk_4_1
                  pkgs.gtk3
                  pkgs.cairo
                  pkgs.gdk-pixbuf
                  pkgs.glib
                  pkgs.dbus
                  pkgs.openssl_3
                  pkgs.librsvg
                  pkgs.libsoup_3
                ]}"

              mkdir -p $out/share/icons/hicolor/scalable/apps
              cp ../public/beaver-icon.svg $out/share/icons/hicolor/scalable/apps/eu.beavertracer.beavertracer.svg
              cp ../public/beaver-icon.svg $out/share/icons/hicolor/scalable/apps/beavertracer.svg

              mkdir -p $out/share/applications
              cat > $out/share/applications/eu.beavertracer.beavertracer.desktop <<'EOF'
[Desktop Entry]
Type=Application
Name=Beaver Tracer
Comment=Interactive Network Simulator & Analyzer
Exec=beavertracer
Icon=eu.beavertracer.beavertracer
Terminal=false
Categories=Education;Network;Science;
StartupWMClass=beavertracer
EOF
            '';
          };
        in
        {
          default = beavertracer;
          inherit frontend;
        }
      );

      devShells = forEachSupportedSystem ({ pkgs }: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            curl
            wget
            pkg-config
            dbus
            openssl_3
            glib
            gtk3
            libsoup_3
            webkitgtk_4_1
            librsvg
            cairo
            gdk-pixbuf
            pango
            harfbuzz
            atk
            nodejs
            rustc
            cargo
          ];

          shellHook = ''
            export LD_LIBRARY_PATH=${pkgs.lib.makeLibraryPath (with pkgs; [
              webkitgtk_4_1
              gtk3
              cairo
              gdk-pixbuf
              glib
              dbus
              librsvg
              libsoup_3
              pango
              harfbuzz
              atk
            ])}:$LD_LIBRARY_PATH
          '';
        };
      });
    };
}
