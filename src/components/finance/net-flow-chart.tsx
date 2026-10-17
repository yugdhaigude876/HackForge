"use client";

import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCompactMinor } from "@/lib/money";
import type { NetFlowPoint } from "@/lib/sample-data";

export function NetFlowChart({ data }: { data: NetFlowPoint[] }) {
  return (
    <div className="h-72 w-full" role="img" aria-label="Hourly net cash flow, sample data">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#1e2d4a" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="hour" stroke="#8a9bb8" fontSize={11} tickLine={false} interval={3} />
          <YAxis
            stroke="#8a9bb8"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={(v: number) => formatCompactMinor(v)}
          />
          <ReferenceLine y={0} stroke="#3b4a68" />
          <Tooltip
            cursor={{ fill: "#111d33" }}
            contentStyle={{ background: "#0c1526", border: "1px solid #1e2d4a", borderRadius: 6, fontSize: 12 }}
            formatter={(v) => [formatCompactMinor(Number(v)), "Net flow"]}
          />
          <Bar dataKey="net" fill="#3b82f6" radius={[2, 2, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
