Real icon files required before packaging:
- icon.png: 512×512 RGBA PNG (Linux + generic)
- icon.ico: Windows multi-resolution (16,32,48,64,128,256px)
- icon.icns: macOS multi-resolution ICNS (generate from icon.png using iconutil on macOS)

NOTE: electron-builder will fail with empty placeholder files. Replace before running electron:pack:* commands.
