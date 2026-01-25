"use client";

import Image from "next/image";

interface FeaturedImageProps {
  src: string;
  alt: string;
}

export function FeaturedImage({ src, alt }: FeaturedImageProps) {
  return (
    <div className="relative w-full h-full overflow-hidden rounded-sm opacity-0 animate-fade-in-up" style={{ animationDelay: "400ms", animationFillMode: "forwards" }}>
      <Image
        src={src}
        alt={alt}
        fill
        className="featured-image"
        priority
        sizes="(max-width: 768px) 100vw, 60vw"
      />
      {/* Subtle vignette overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/10 via-transparent to-transparent pointer-events-none" />
    </div>
  );
}

