// Import here Polyfills if needed. Recommended core-js (npm i -D core-js)
// import "core-js/fn/array.find"
// ...
import { ApiConfig } from "arweave/web/lib/api";
var tou8 = require("buffer-to-uint8array");

const IpfsHttpClientLite = require("ipfs-http-client-lite");
const isIPFS = require("is-ipfs");
let Arweave;
function isNodejs() {
  return (
    typeof process === "object" &&
    typeof process.versions === "object" &&
    typeof process.versions.node !== "undefined"
  );
}
if (isNodejs()) {
  Arweave = require("arweave/node");
} else {
  Arweave = require("arweave/web").default;
}
const IPFS_KEY = "IPFS-Add";

//temporary so it doesnt conflict with different data structure
const IPFS_CONSTRAINT_KEY = "standard";
const IPFS_CONSTRAINT = "v0.1";

type HashWithIds = { [key: string]: string };

export default class ArweaveIpfs {
  arweave: any;
  ipfs: any;
  constructor(
    ipfs_opts: any = {
      host: "ipfs.infura.io",
      port: 5001,
      protocol: "https",
    },
    arweave_opts: ApiConfig = {
      host: "arweave.net",
      port: 443,
      protocol: "https",
    }
  ) {
    this.arweave = Arweave.init(arweave_opts);
    this.ipfs = IpfsHttpClientLite({
      apiUrl: `${ipfs_opts.protocol}://${ipfs_opts.host}:${ipfs_opts.port}`,
      headers: ipfs_opts.headers,
    });
  }
  add = async (
    hashes: Array<string> | string | Array<object>,
    jwk: any,
    skipArFetch = false
  ): Promise<HashWithIds> => {
    if (!Array.isArray(hashes)) {
      hashes = [hashes];
    }
    let refinedHashes: Array<string>;
    if (typeof hashes[0] != "string") {
      //@ts-ignore
      refinedHashes = hashes.map((o) => o.hash);
    } else {
      //@ts-ignore
      refinedHashes = hashes;
    }
    let arIds: Array<string> = Array(hashes.length).fill(null);
    if (!skipArFetch) {
      arIds = await this.getArIdFromHashes(refinedHashes);
    }
    let x = await Promise.all(
      refinedHashes.map(async (o, i) => {
        if (arIds[i] == null) {
          return await this.addHash(o, jwk);
        } else {
          return makeHashWithIds(o, arIds[i]);
        }
      })
    );
    return Object.assign({}, ...x);
  };
  get = async (
    hashes: Array<string> | string,
    jwk: any = null
  ): Promise<any> => {
    if (typeof hashes == "string") {
      hashes = [hashes];
    }
    let ids = await this.getArIdFromHashes(hashes);
    let hashToPushToAr: Array<String> = [];
    let x = await Promise.all(
      ids.map(async (o, i) => {
        let h = hashes[i];
        if (o != null) {
          try {
            let tx = await this.arweave.transactions.get(o);
            return { [h]: Array.from(tx.get("data", { decode: true })) };
          } catch (e) {
            return { [h]: [] };
            //do nothing returns undefined
          }
        } else {
          hashToPushToAr.push(h);
          const data: Buffer = await this.ipfs.cat(h);
          return { [h]: Array.from(tou8(data)) };
        }
      })
    );
    if (jwk && hashToPushToAr.length > 0) {
      this.add(hashToPushToAr, jwk, true);
    }
    return Object.assign({}, ...x);
  };
  getArIdFromHashes = async (hashes: Array<string>): Promise<Array<string>> => {
    return Promise.all(
      hashes.map(async (o) => {
        if (isIPFS.multihash(o)) {
          let x = await this.arweave.arql({
            op: "and",
            expr1: {
              op: "equals",
              expr1: IPFS_KEY,
              expr2: o,
            },
            expr2: {
              op: "equals",
              expr1: IPFS_CONSTRAINT_KEY,
              expr2: IPFS_CONSTRAINT,
            },
          });
          if (x.length > 0) {
            return x[0];
          } else {
            return null;
          }
        } else {
          return o;
        }
      })
    );
  };
  addHash = async (h: string, jwk: any): Promise<HashWithIds> => {
    if (!isIPFS.multihash(h)) {
      return makeHashWithIds(h, "Invalid IPFS hash");
    }
    const data: Buffer = await this.ipfs.cat(h);
    let transaction = await this.arweave.createTransaction(
      { data: tou8(data) },
      jwk
    );
    transaction.addTag(IPFS_KEY, h);
    transaction.addTag(IPFS_CONSTRAINT_KEY, IPFS_CONSTRAINT);
    transaction.addTag("Content-Type", "image/png");

    //fast blocks hack
    const anchor_id = (await this.arweave.api.get("/tx_anchor")).data;
    transaction.last_tx = anchor_id;

    await this.arweave.transactions.sign(transaction, jwk);
    await this.arweave.transactions.post(transaction);
    return makeHashWithIds(h, transaction.id);
  };
}
const makeHashWithIds = (hash: string, id: string): HashWithIds => {
  return { [hash]: id };
};
