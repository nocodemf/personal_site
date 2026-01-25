"use client";

import Image from "next/image";

interface RolodexProps {
  images: string[];
}

export function Rolodex({ images }: RolodexProps) {
  // Use first 6 images
  const displayImages = images.slice(0, 6);

  return (
    <div className="rolodex-container">
      <div className="rolodex-scene">
        <div className="rolodex-row">
          {displayImages.map((src, index) => (
            <div key={index} className="rolodex-record">
              <Image
                src={src}
                alt={`Image ${index + 1}`}
                width={300}
                height={400}
                className="rolodex-image"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
