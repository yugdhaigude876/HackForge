"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/providers/theme-provider";
import { Button } from "@/components/ui/primitives";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      className={className}
    >
      {theme === "dark" ? (
        <Sun className="h-4 w-4 text-warning transition-transform duration-200 hover:rotate-45" />
      ) : (
        <Moon className="h-4 w-4 text-primary transition-transform duration-200 hover:-rotate-12" />
      )}
    </Button>
  );
}
