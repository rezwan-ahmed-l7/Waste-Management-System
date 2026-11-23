import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BAUST CSE Fest | Waste Management",
  description: "Report waste, coordinate collection, and track responsible disposal for BAUST CSE Fest."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
