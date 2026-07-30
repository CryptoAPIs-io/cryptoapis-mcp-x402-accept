# @cryptoapis-io/mcp-x402-accept

## 0.1.1

### Patch Changes

- ff80ffb: Ship `server.json` in the published package.

  0.1.0 was published with `files: ["dist","LICENSE"]`, so its `server.json` never reached the npm
  tarball. The MCP Registry reads that file, and every sibling package includes it — without it the
  registry entry cannot be published from the package at all.
