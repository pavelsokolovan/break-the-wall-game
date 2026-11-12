import { BlockList, isIP } from "node:net";

const normalized = (ip) =>
  ip?.startsWith("::ffff:") && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
/** Explicit networks only; never trust arbitrary forwarding headers by hop count. */
export function clientAddressResolver(cidrs = "") {
  const list = new BlockList();
  for (const cidr of cidrs
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const [address, rawPrefix, extra] = cidr.split("/");
    const version = isIP(address),
      prefix = Number(rawPrefix);
    if (
      extra !== undefined ||
      rawPrefix === undefined ||
      !/^\d+$/.test(rawPrefix) ||
      !version ||
      !Number.isInteger(prefix) ||
      prefix <= 0 ||
      prefix > (version === 4 ? 32 : 128)
    )
      throw new TypeError("Invalid TRUSTED_PROXY_CIDRS");
    list.addSubnet(address, prefix, version === 4 ? "ipv4" : "ipv6");
  }
  const trusted = (ip) => {
    const v = isIP(ip);
    return !!v && list.check(ip, v === 4 ? "ipv4" : "ipv6");
  };
  return (request) => {
    const peer = normalized(request.socket.remoteAddress) || "unknown";
    if (!trusted(peer)) return peer;
    const header = request.headers["x-forwarded-for"];
    if (typeof header !== "string" || header.length > 2048) return peer;
    const chain = header.split(",").map((s) => normalized(s.trim()));
    if (!chain.length || chain.length > 32 || chain.some((ip) => !isIP(ip)))
      return peer;
    let current = peer;
    for (let i = chain.length - 1; i >= 0 && trusted(current); i--)
      current = chain[i];
    return current;
  };
}
export function lifecycleLogger(
  level = "silent",
  write = (line) => console.log(line),
) {
  if (!["silent", "info"].includes(level))
    throw new TypeError("Invalid LOG_LEVEL");
  return (event, fields = {}) => {
    if (level === "silent") return;
    const clean = { event };
    for (const key of [
      "code",
      "matchId",
      "reason",
      "port",
      "connections",
      "status",
    ])
      if (["string", "number"].includes(typeof fields[key]))
        clean[key] = fields[key];
    write(JSON.stringify(clean));
  };
}
