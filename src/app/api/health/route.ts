import { NextResponse } from "next/server";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    ok: true,
    version: "0.2.0",
    time: new Date().toISOString(),
  });
}
