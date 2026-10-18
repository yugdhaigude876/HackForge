import { describe, it, expect, beforeAll } from "vitest";
import { SignJWT, generateKeyPair, type JWTVerifyGetKey } from "jose";
import { JoseTokenVerifier } from "@/server/jose-verifier";
import { classifyAuthFailure } from "@/server/auth";

const PROJECT = "demo-project";
let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;
let getKey: JWTVerifyGetKey;

const sign = (claims: Record<string, unknown>, opts: { key?: CryptoKey; iss?: string; aud?: string; exp?: string | number; sub?: string | null } = {}) => {
  const jwt = new SignJWT({ email: "a@bank.internal", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuedAt()
    .setIssuer(opts.iss ?? `https://securetoken.google.com/${PROJECT}`)
    .setAudience(opts.aud ?? PROJECT)
    .setExpirationTime(opts.exp ?? "1h");
  if (opts.sub !== null) jwt.setSubject(opts.sub ?? "uid-123");
  return jwt.sign(opts.key ?? privateKey);
};

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  otherPrivateKey = (await generateKeyPair("RS256")).privateKey;
  getKey = (async () => pair.publicKey) as unknown as JWTVerifyGetKey;
});

const verifier = () => new JoseTokenVerifier({ projectId: PROJECT, getKey });

describe("JoseTokenVerifier (Firebase ID token verification without firebase-admin/auth)", () => {
  it("accepts a valid token and returns uid and email", async () => {
    await expect(verifier().verifyIdToken(await sign({}))).resolves.toEqual({ uid: "uid-123", email: "a@bank.internal" });
  });

  it("rejects an expired token", async () => {
    const token = await sign({}, { exp: Math.floor(Date.now() / 1000) - 3600 });
    await expect(verifier().verifyIdToken(token)).rejects.toThrow();
  });

  it("rejects a token for another Firebase project (wrong audience and issuer)", async () => {
    const token = await sign({}, { aud: "other-project", iss: "https://securetoken.google.com/other-project" });
    const err = await verifier().verifyIdToken(token).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(classifyAuthFailure(err)).toBe("wrong-project");
  });

  it("rejects a token signed with a different key", async () => {
    const token = await sign({}, { key: otherPrivateKey });
    await expect(verifier().verifyIdToken(token)).rejects.toThrow();
  });

  it("rejects a token without a subject", async () => {
    const token = await sign({}, { sub: null });
    await expect(verifier().verifyIdToken(token)).rejects.toThrow(/subject/i);
  });

  it("rejects garbage", async () => {
    await expect(verifier().verifyIdToken("not.a.jwt")).rejects.toThrow();
    await expect(verifier().verifyIdToken("")).rejects.toThrow();
  });
});
