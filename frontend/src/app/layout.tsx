import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: "KICKOFF — Real-world events on Injective",
  description:
    "On-chain event oracle + MCP agent for World Cup match events. x402 payments · CCTP drops · Injective EVM.",
  icons: {
    icon: "/header.png",
    apple: "/header.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className="flex min-h-screen flex-col antialiased font-sans">
        <Providers>
          <Nav />
          <main className="flex-1">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
