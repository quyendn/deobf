import fs from "fs";
import { execSync } from "child_process";
import CryptoJS from "crypto-js";
import { exit } from "process";

(async () => {
  try {
    const resource = await fetch(
      "https://flixhq.to/ajax/episode/sources/11080747"
    );
    const resourceData = await resource.json();
    if (resourceData.type !== "iframe") {
      console.error("[!] Resource type is not iframe:", resourceData);
      exit(1);
    }
    const link = resourceData.link;
    const resourceLinkMatch = link.match(
      /https:\/\/([^/]+)\/embed-1\/v2\/e-1\/([^?]+)/
    );
    if (!resourceLinkMatch) {
      console.error(
        "[!] Failed to extract domain and ID from link:",
        resourceData
      );
      exit(2);
    }
    const baseUrl = `https://${resourceLinkMatch[1]}`;
    const ID = resourceLinkMatch[2];
    const USER_AGENT =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:139.0) Gecko/20100101 Firefox/139.0";

    async function fetchUrl(url, additionalHeaders = {}) {
      const headers = {
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": USER_AGENT,
        ...additionalHeaders,
      };
      const res = await fetch(baseUrl + url, { headers });
      if (!res.ok) {
        console.error(
          `[!] Failed to fetch ${url}: ${res.status} ${res.statusText}`
        );
        exit(3);
      }
      return await res.text();
    }
    // Fetch obfuscated JS

    const obfuscatedJS = await fetchUrl(
      `/js/player/m/v2/pro/embed-1.min.js?v=${Math.floor(Date.now() / 1000)}`
    );
    fs.writeFileSync("input.txt", obfuscatedJS);
    console.debug("[*] JavaScript content retrieved and saved to input.txt");
    //https://cdnstreame.net/embed-1/v2/e-1/getSources?id=h7cD4Kxz0kg9
    // Fetch encrypted sources

    const embedContentRaw = await fetchUrl(
      `/embed-1/v2/e-1/getSources?id=${ID}`,
      { referer: `${baseUrl}/embed-1/v2/e-1/getSources?id=${ID}` }
    );
    const embedContent = JSON.parse(embedContentRaw);
    if (!embedContent.sources || !embedContent.sources.length) {
      console.error("[!] No sources found in embed content:", embedContent);
      exit(4);
    }
    const encryptedBase64 = embedContent.sources;
    console.debug("[*] Encrypted Source:", encryptedBase64);

    // Run deobfuscate.js (assumes it writes to output.js)
    execSync("node ./deobfuscate.js", { stdio: "ignore" });
    const deobfuscated = fs.readFileSync("output.js", "utf8");
    try {
      // [
      //     {
      //         file: 'https://eh.netmagcdn.com:2228/hls-playback/.../master.m3u8',
      //         type: 'hls'
      //     }
      // ]

      const [json, key] = extractKey(deobfuscated, encryptedBase64);

      console.log("[*] Decrypted JSON:", json);
      console.log("\n[*] Decryption Key:", key);
      fs.writeFileSync("./data/decryption_key", key);
    } catch (ex) {
      console.error(`[!] Failed to parse decrypted JSON: (${ex.message})`);
      exit(6);
    }
  } catch (ex) {
    console.error("[!] Error:", ex.message);
    exit(7);
  }
  // We Extract domain & ID from the link https://{domain}/embed-2/v2/e-1/{id}?k=1
})();
function extractKey(deobfuscated, encryptedBase64Content) {
  const lines = deobfuscated.split("\n");

  // 1. Tìm index của dòng đầu tiên có "CryptoJS"
  const startIdx = lines.findIndex((line) => line.includes("CryptoJS"));
  if (startIdx === -1) {
    console.error('Không tìm thấy chuỗi "CryptoJS" trong file.');
  }
  // 2. Tính từ 25 dòng trước đó đến chính dòng đó
  const from = Math.max(0, startIdx - 80);
  const to = startIdx; // bao gồm cả dòng chứa CryptoJS
  // 3. Lấy và in ra
  const snippet = lines.slice(from, to + 1).join("\n");
  console.log(`--- Đoạn mã từ dòng ${from + 1} đến ${to + 1} ---\n`);
  console.log(snippet);

  // Iterate over n, each element is an index into K. each index should not exceed K's length
  // K = ["542", "e3", "8129", "68c", "974c", "3", "9a11", "922a", "0b0", "89c", "6b", "7b", "b21c", "3295", "91", "7", "ec", "ffcf", "4a89", "a", "fcd3", "d2", "b"];
  // n = [3, 16, 18, 14, 0, 19, 22, 9, 21, 7, 12, 13, 6, 1, 11, 2, 15, 4, 20, 17, 10, 5, 8];
  const v1Regex =
    /\w+\s*=\s*(\[(?:"[^"]*",?\s*)+\]);\s*\w+\s*=\s*(\[(?:\d+,?\s*)+\]);/;
  // Hex string that's 64 characters long
  // D = "--217b4f4cbd4baeb5bdaeb43096f55c9095f7ab789a7498dda782473eaee2c791";
  const v2Regex = /([a-f0-9]{64,})/;
  // Each element is an int string that gets converted to hex, then back to a character
  // O = ["30", "30", "63", "61", "33", "65", "66", "30", "63", "61", "65", "62", "32", "65", "64", "31", "65", "65", "38", "31", "65", "36", "35", "36", "35", "64", "63", "36", "61", "61", "38", "34", "37", "32", "62", "35", "33", "35", "33", "36", "61", "34", "65", "62", "30", "65", "35", "34", "62", "32", "62", "39", "64", "31", "63", "63", "31", "64", "39", "38", "61", "30", "34", "64"];
  const v3Regex = /\w+\s*=\s*(\[(?:"[0-9a-fA-F]+",?\s*){64}\])/;
  // Each element is an int that's just a character
  // a = [97, 56, 55, 55, 50, 100, 49, 57, 50, 53, 101, 53, 53, 48, 55, 56, 101, 53, 99, 101, 48, 57, 98, 101, 56, 98, 99, 54, 50, 101, 99, 54, 56, 99, 98, 100, 98, 53, 102, 102, 50, 56, 55, 52, 55, 52, 101, 54, 54, 101, 99, 49, 51, 49, 97, 100, 98, 52, 49, 48, 98, 51, 49, 98];
  // h = () => {
  // p.z9e.s2fm9gH();
  // if (p.q4.m8Eqosd()) {
  // return g8HqS["fromCharCode"](...a);
  // }
  const v4Regex = /\w+\s*=\s*(\[(?:\d+,?\s*)+\])/;
  // Simply base64
  // L = "YzAwZmZhY2NiNjZmODliODMzNGUyYzNmMTI3NDE4Mjg0ZGNjNThlMzUxN2Y2MWRiYmM2ZjZiZDk3Mzc1MGNhYw==";
  // h = () => {
  //   z.F6L.Z0lkAgs();
  //   if (!z.t2.Q1kzx_R()) {
  //     return W_cei(L);
  //   }
  const v5Regex =
    /((?:[A-Za-z0-9+/]{4}){16,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)/;

  const fnRegex =
    /(Y|J|E|u|I|G|k)\s*=\s*\(\)\s*=>\s*{[\s\S]*?return\s*['"]([^'"]+)['"]/g;

  const matchFXX = snippet.match(/F\s*=\s*['"]([^'"]+)['"]/);

  const vMatchT = deobfuscated.match(/V\s*=\s*\[\s*([\s\S]*?)\s*\]\s*;/);
  // 2. Tìm block V = [ ... ]; mà phần tử đầu là "53"
  const vBlockRegex = /V\s*=\s*\[\s*"53"[\s\S]*?\];/;

  const vMatchTT = deobfuscated.match(/V\s*=\s*['"]([^'"]+)['"]/);


  const zMatchz = deobfuscated.match(/z\s*=\s*["']([^"']+)["']/);


  // 2. Trích V3["a"]
  const aMatcha = deobfuscated.match(/V3\["a"\]\s*=\s*"([^"]+)"/);
  if (aMatcha) 
  {
    try {
        const aVal = aMatcha[1];
        // 3. Trích V3["b"] → hàm trả về chuỗi
        const bMatch = deobfuscated.match(/V3\["b"\]\s*=\s*\(\)\s*=>\s*{[\s\S]*?return\s*"([^"]+)"/);
        if (!bMatch) console.error("Not Decrypt with bMatch");
        const bVal = bMatch[1];
        // 4. Trích V3["c"]
        const cMatch = deobfuscated.match(/V3\["c"\]\s*=\s*"([^"]+)"/);
        if (!cMatch) console.error("Not Decrypt with cMatch");
        const cVal = cMatch[1];
        // 5. Ghép key
        const aesKeyR = aVal + bVal + cVal;

        console.log('✅ AES key =', aesKeyR);
        if(aesKeyR.length > 0)
        {
          let result = tryDecryptJson(encryptedBase64Content, aesKeyR);
          if (result) {
            console.log(
              "[*] (vMatchTT) Key found when checking for reverse arrays."
            );
            return [result, aesKeyR];
          } else console.error("Not Decrypt with key");
        }
    } catch (error) {

    }
  }
  if (zMatchz) {
     const base64Key  = zMatchz[1];
    console.log('Found Base64 key:', base64Key);
    // 3. Decode Base64 thành AES key
    const aesKey = Buffer.from(base64Key, 'base64').toString('utf8');
    // 4. In ra
    console.log('AES key =', aesKey);
    if(aesKey.length > 0)
    {
      try {
         let result = tryDecryptJson(encryptedBase64Content, aesKey);
          if (result) {
            console.log(
              "[*] (vMatchTT) Key found when checking for reverse arrays."
            );
            return [result, aesKey];
          } else console.error("Not Decrypt with key");
      } catch (error) {
        
      }
    }
    
  }
 
  try {
    // 1. Lấy đoạn chứa Z.U2V.M1tu_6N() và mảng T/v
    const start = deobfuscated.indexOf("Z.U2V.M1tu_6N()");
    const snippet = deobfuscated.substring(start, start + 5000);

    // 2. Trích v
    const vMatchT = snippet.match(/v\s*=\s*(\d+)\s*;/);
    if (vMatchT) {
      const v = parseInt(vMatchT[1], 10);

      // 3. Trích mảng T
      const tMatchMM = snippet.match(/T\s*=\s*\[([\d,\s]+)\]\s*;/);
      if (tMatchMM) {
        const T = tMatchMM[1].split(",").map((s) => parseInt(s.trim(), 10));

        // 4. XOR từng byte với v và build key
        const aesKeyMY = T.map((byte) => String.fromCharCode(byte ^ v)).join(
          ""
        );
        // 5. In kết quả
        console.log("AES key =", aesKeyMY);
        if (aesKeyMY.length > 0) {
          let result = tryDecryptJson(encryptedBase64Content, aesKeyMY);
          if (result) {
            console.log(
              "[*] (vMatchTT) Key found when checking for reverse arrays."
            );
            return [result, aesKeyMY];
          } else console.error("Not Decrypt with key");
        }
      }
    }
  } catch (error) {}

  if (vMatchTT) {
    // 3. Lấy chuỗi V và remove ký tự đầu
    const V = vMatchTT[1]; // e.g. "-gcPoP5rF0hQzRthkXvqfOu4IcbxnmBcx0VquecTRy5n3Eu9FX"
    const aesKeyMM = V.slice(1);
    if (aesKeyMM.length > 0) {
      try {
        let result = tryDecryptJson(encryptedBase64Content, aesKeyMM);
        if (result) {
          console.log(
            "[*] (vMatchTT) Key found when checking for reverse arrays."
          );
          return [result, aesKeyMM];
        } else console.error("Not Decrypt with key");
      } catch (error) {}
    }
  }

  const vBlockMatch = deobfuscated.match(vBlockRegex);
  if (vBlockMatch) {
    try {
      const vBlock = vBlockMatch[0];
      console.log("--- V block ---\n", vBlock, "\n---------------\n");

      // 3. Lấy nội dung giữa dấu [ và ] (bỏ V = [ và ];)
      const rawArray = vBlock
        .replace(/^V\s*=\s*\[/, "")
        .replace(/\];$/, "")
        .trim();

      // 4. Dùng matchAll để trích mọi chuỗi hex như "53", "30", ...
      const hexStrings = Array.from(
        rawArray.matchAll(/"([0-9A-Fa-f]+)"/g),
        (m) => m[1]
      );
      console.log("Parsed hex count =", hexStrings.length);
      console.log("First few hexes:", hexStrings.slice(0, 8));

      if (hexStrings.length === 0) {
        console.error("❌ Không tìm thấy phần tử hex nào trong V.");
      }
      // 5. Chuyển mỗi hex thành ký tự, rồi nối thành key
      const aesKeyM = hexStrings
        .map((h) => String.fromCharCode(parseInt(h, 16)))
        .join("");

      console.log("\n✅ AES key =", aesKeyM);
      if (aesKeyM.length > 0) {
        let result = tryDecryptJson(encryptedBase64Content, aesKeyM);
        if (result) {
          console.log(
            "[*] (oMatchXY) Key found when checking for reverse arrays."
          );
          return [result, aesKeyM];
        } else console.error("Not Decrypt with key");
      }
    } catch (error) {}
  }

  // 2. Regex tìm biến O = "--....";
  const oMatchXY = deobfuscated.match(/O\s*=\s*['"]([^'"]+)['"]/);
  if (oMatchXY) {
    try {
      console.log("tìm thấy biến O trong file.");
      const O = oMatchXY[1]; // e.g. "--XDoci5Wqaf2jQlfAse6Zdk8d1rkPKWPc9"
      // 3. Logic của Y(): return O.slice(2)
      const aesKeyX = O.slice(2);
      if (aesKeyX.length > 0) {
        let result = tryDecryptJson(encryptedBase64Content, aesKeyX);
        if (result) {
          console.log(
            "[*] (oMatchXY) Key found when checking for reverse arrays."
          );
          return [result, aesKeyX];
        } else console.error("Not Decrypt with key");
      }
    } catch {}
  }

  try {
    if (matchFXX) {
      // 2. Lấy giá trị F
      const F = matchFXX[1];

      // 3. Đảo ngược chuỗi để được key
      const aesKey = F.split("").reverse().join("");
      if (aesKey.length > 0) {
        let result = tryDecryptJson(encryptedBase64Content, aesKey);
        if (result) {
          console.log(
            "[*] (oMatch) Key found when checking for reverse arrays."
          );
          return [result, aesKey];
        } else console.error("Not Decrypt with key");
      }
    }
  } catch {}

  try {
    const oMatchF = snippet.match(fnRegex);
    if (oMatchF) {
      const parts = {};
      let m;
      while ((m = fnRegex.exec(snippet)) !== null) {
        const [_, name, value] = m;
        parts[name] = value;
      }

      // Đảm bảo có đủ 7 phần
      const order = ["Y", "J", "E", "u", "I", "G", "k"];
      for (const n of order) {
        if (!(n in parts)) {
          throw new Error(`Không tìm thấy hàm ${n} trong file.`);
        }
      }

      const aesKey = order.map((n) => parts[n]).join("");
      if (aesKey.length > 0) {
        let result = tryDecryptJson(encryptedBase64Content, aesKey);
        if (result) {
          console.log(
            "[*] (oMatch) Key found when checking for reverse arrays."
          );
          return [result, aesKey];
        } else console.error("Not found key");
      }
    }
  } catch {}

  const oMatch = snippet.match(/o\s*=\s*['"]([^'"]+)['"]/);
  if (oMatch) {
    const o = oMatch[1];
    // 2. Đảo ngược chuỗi để lấy key
    const aesKey = o.split("").reverse().join("");
    console.log("key:" + aesKey);
    if (aesKey.length > 0) {
      let result = tryDecryptJson(encryptedBase64Content, aesKey);
      if (result) {
        console.log("[*] (oMatch) Key found when checking for reverse arrays.");
        return [result, aesKey];
      } else console.error("Not found key");
    }
  }

  const fMatch = snippet.match(/f\s*=\s*['"]([^'"]+)['"]/);
  if (fMatch) {
    try {
      const f = fMatch[1];
      console.log("Base64 f =", f);
      console.log("[*] (fMatch)");
      // 3. Decode Base64 thành AES key
      const key = Buffer.from(f, "base64").toString("utf-8");
      console.log("key:" + key);
      if (key.length > 0) {
        let result = tryDecryptJson(encryptedBase64Content, key);
        if (result) {
          console.log("[*] (fMatch) Key found when checking for hex arrays.");
          return [result, key];
        } else console.error("[!] Hex array does not have 64 elements.");
      }
    } catch {}
  }

  var E;
  // 2. Dùng regex trích E: số sau “E = ”
  const eMatch = deobfuscated.match(/(?:var\s+)?E\s*=\s*(\d+)\s*;/);
  if (!eMatch) {
    console.log("[*] (V3) Not found E.");
  } else {
    E = parseInt(eMatch[1], 10);
  }
  // 3. Dùng regex trích mảng z: các số bên trong […]
  const zMatch8 = deobfuscated.match(/z\s*=\s*\[([\d\s,]+)\]/);
  if (zMatch8) {
    console.log("zMatch8");
    const z = zMatch8[1].split(",").map((s) => parseInt(s.trim(), 10));
    const key = String.fromCharCode(...z.map((byte) => byte ^ E));
    console.log("key:" + key);
    if (key.length > 0) {
      let result = tryDecryptJson(encryptedBase64Content, key);
      if (result) {
        console.log("[*] (V8) Key found when checking for hex arrays.");
        return [result, key];
      } else console.error("[!] Hex array does not have 64 elements.");
    }
  }

  const v7Regex = /v\s*=\s*['"]--([^'"]+)['"]/;

  const v7Match = deobfuscated.match(v7Regex);
  if (v7Match) {
    console.log("v7Match");
    const key = v7Match[1];
    console.log("key:" + key);
    if (key.length > 0) {
      let result = tryDecryptJson(encryptedBase64Content, key);
      if (result) {
        console.log("[*] (V3) Key found when checking for hex arrays.");
        return [result, key];
      } else console.error("[!] Hex array does not have 64 elements.");
    }
  }

  const v6Regex = /t\s*=\s*(\[[\s\S]*?\]);/;

  const v6Match = deobfuscated.match(v6Regex);
  if (v6Match) {
    try {
      console.log("v6Match");
      const arrayString = v6Match[1];
      const t = eval(arrayString);
      console.log(t);
      const key = t.map((v) => String.fromCharCode(parseInt(v, 16))).join("");
      console.log("key:" + key);
      if (key.length > 0) {
        let result = tryDecryptJson(encryptedBase64Content, key);
        if (result) {
          console.log("[*] (V3) Key found when checking for hex arrays.");
          return [result, key];
        } else console.error("[!] Hex array does not have 64 elements.");
      }
    } catch {
      console.error("[!] Hex array does not have 64 elements.");
    }
  }
  // -----------------------------------------------------------------
  const v1Match = deobfuscated.match(v1Regex);
  if (v1Match) {
    const pattern = JSON.parse(v1Match[1]);
    const index = JSON.parse(v1Match[2]);
    let key = index.map((i) => pattern[i]).join("");
    if (key.length > 0) {
      let result = tryDecryptJson(encryptedBase64Content, key);
      if (result) {
        console.log("[*] (V1) Key found when checking for string mapping.");
        return [result, key];
      }
    }
  }

  const v2Match = deobfuscated.match(v2Regex);
  if (v2Match) {
    let key = v2Match[1];
    if (key.length > 0) {
      let result = tryDecryptJson(encryptedBase64Content, key);
      if (result) {
        console.log("[*] (V2) Key found when checking for hex strings.");
        return [result, key];
      } else {
        key = v2Match[1].split("").reverse().join("");
        result = tryDecryptJson(encryptedBase64Content, key);
        if (result) {
          console.log(
            "[*] (V6) Key found when checking for reversed-hex strings."
          );
          return [result, key];
        }
      }
    }
  }

  const v3Match = deobfuscated.match(v3Regex);
  if (v3Match) {
    const hexArray = JSON.parse(v3Match[1]);
    if (hexArray.length === 64) {
      let key = hexArray
        .map((hex) => String.fromCharCode(parseInt(hex, 16)))
        .join("");
      if (key.length > 0) {
        let result = tryDecryptJson(encryptedBase64Content, key);
        if (result) {
          console.log("[*] (V3) Key found when checking for hex arrays.");
          return [result, key];
        }
      }
    } else console.error("[!] Hex array does not have 64 elements.");
  }

  const v4Match = deobfuscated.match(v4Regex);
  if (v4Match) {
    const intArray = JSON.parse(v4Match[1]);
    let key = intArray.map((i) => String.fromCharCode(i)).join("");
    if (key.length > 0) {
      let result = tryDecryptJson(encryptedBase64Content, key);
      if (result) {
        console.log("[*] (V4) Key found when checking for int arrays.");
        return [result, key];
      }
    }
  }

  const v5Match = deobfuscated.match(v5Regex);
  if (v5Match) {
    let key = atob(v5Match[1]);
    if (key.length == 64) {
      let result = tryDecryptJson(encryptedBase64Content, key);
      if (result) {
        console.log(
          "[*] (V5) Key found when checking for base64 strings longer than 64 characters."
        );
        return [result, key];
      }
    }
  }

  console.error(
    "[!] Regexes did not match any known patterns for key extraction."
  );
  exit(5);
}

function tryDecryptJson(encryptedBase64, key) {
  try {
    const decrypted = CryptoJS.AES.decrypt(encryptedBase64, key);
    return JSON.parse(decrypted.toString(CryptoJS.enc.Utf8));
  } catch (ex) {
    console.error(
      `[!] Failed to decrypt json with key ${key}, (${ex.message})`
    );
    return "";
  }
}
