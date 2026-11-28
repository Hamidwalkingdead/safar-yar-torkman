type MapirAttributionProps = {
  className?: string;
};

const MAPIR_LOGO_URL = "https://help.map.ir/wp-content/uploads/2020/10/logo.png";

export function MapirAttribution({ className = "" }: MapirAttributionProps) {
  return (
    <div
      aria-label="نشان و منبع نقشه مپ"
      className={`pointer-events-none absolute bottom-2 left-2 z-20 flex items-center gap-2 rounded-md border border-black/10 bg-white/90 px-2 py-1 shadow-sm ${className}`}
    >
      <a
        href="https://map.ir"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="وب‌سایت مپ"
        className="pointer-events-auto inline-flex items-center"
      >
        <img
          src={MAPIR_LOGO_URL}
          alt="Map.ir"
          loading="lazy"
          decoding="async"
          className="h-3 w-auto max-w-[84px] object-contain"
        />
      </a>
      <span dir="ltr" className="text-[9px] leading-none text-slate-700">
        © OpenStreetMap contributors
      </span>
    </div>
  );
}
