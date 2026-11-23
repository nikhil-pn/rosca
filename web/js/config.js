// Where Rosca lives on the QoreChain testnet (from deployments/testnet.json).
export const CONFIG = {
  evmRpc: "https://evm-testnet.qore.host",
  explorer: "https://explore.qore.network",
  /** The current factory. New circles open here. */
  factory: "0x36f0e01992b585df9f3752bca56a07dfcdf02817",
  /** Earlier factories, oldest first. Their circles stay live, so the site reads them all. */
  olderFactories: ["0x366d6a029d94a98ba4d93e2eb4dbf07720387d39", "0x29053772f08c30c682e0fbb5db3a3d86ac84afef", "0x8197d7a6345b0b087976e5412629514719ccbd2f"],
  factoryBlock: 10437979,
  fusd: "0x97143B771D34ddb9130b807b135Ae675A5a963CA",
  fusdDecimals: 6,
  /** The committed deployments record, which also lists the keeper's thief attempts. */
  deployments: "https://raw.githubusercontent.com/nikhil-pn/rosca/main/deployments/testnet.json",
  /** The keeper's organiser account: the site's live circle only shows circles it opened. */
  keeper: "0x0ec42d73ed8a38dd6573d3ca10212952672f8a0e",
};

// The five demo members the keeper plays, and the organiser. Throwaway testnet accounts.
export const PEOPLE = {
  "0x351bdbaf6ef77ba62e9b40b3cdfc48e37d27b4e0": "Anu",
  "0x24bf5471b96f233f5d9a4eccbdf2c5abd0a9b7d0": "Biju",
  "0x9333c3fa95306f9440789db1b0a2d86ec260e90e": "Chitra",
  "0x2a984e5167777e90735aa039782ec1bc3f2896be": "Deepak",
  "0x420e316e1bd1ca7915872cd7307623afcb901f73": "Esther",
  "0x0ec42d73ed8a38dd6573d3ca10212952672f8a0e": "The organiser",
  // The two bots that join visitors' circles on the "Try it yourself" page.
  "0x43852c8c1370aa794207475e9b83eb5c59797863": "Ravi (bot)",
  "0x5c98e56d59878248320971f56a701c28de4bce91": "Meera (bot)",
};

export const who = (a) => PEOPLE[a.toLowerCase()] ?? `${a.slice(0, 6)}…${a.slice(-4)}`;
