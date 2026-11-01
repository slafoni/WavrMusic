export function BackgroundVideo({ src, className }: { src: string; className?: string }) {
  return (
    <video
      className={className}
      src={src}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      tabIndex={-1}
      disablePictureInPicture
      aria-hidden="true"
    />
  );
}
