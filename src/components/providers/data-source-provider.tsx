"use client";

import React, { createContext, useContext, useState, type ReactNode } from "react";

export type DataSource = "live" | "synthetic" | "offline-fallback" | "demo" | "dataset";

interface DataSourceContextValue {
  source: DataSource | null;
  setSource: (source: DataSource | null) => void;
}

const DataSourceContext = createContext<DataSourceContextValue>({
  source: null,
  setSource: () => {},
});

export function DataSourceProvider({ children }: { children: ReactNode }) {
  const [source, setSource] = useState<DataSource | null>(null);
  return (
    <DataSourceContext.Provider value={{ source, setSource }}>
      {children}
    </DataSourceContext.Provider>
  );
}

export function useDataSource() {
  return useContext(DataSourceContext);
}
