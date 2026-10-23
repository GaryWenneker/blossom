import { randomBytes } from "node:crypto";
console.log(randomBytes(32).toString("base64"));
console.log("Save this key outside the repository, for example in 1Password.");
