import type { Metadata } from "next";
import { Inter, Xanh_Mono, Source_Serif_4 } from "next/font/google";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const xanhMono = Xanh_Mono({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-xanh-mono",
  display: "swap",
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-source-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Urav Shah",
  description: "Personal site - ventures, travel, food, design, projects, learnings",
  icons: {
    icon: "/favicon.png",
    apple: "/favicon.png",
  },
  openGraph: {
    title: "Urav Shah",
    description: "Personal site",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${xanhMono.variable} ${sourceSerif.variable} font-sans antialiased`}>
        <ConvexClientProvider>
          {children}
        </ConvexClientProvider>
      </body>
    </html>
  );
}
