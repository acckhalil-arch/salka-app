'use client';

import React, { useEffect, useRef, useState } from 'react';

export interface MapHazard {
  id: number;
  created_at: string;
  sender: string;
  image_url: string | null;
  latitude: number | null;
  longitude: number | null;
  location_name: string | null;
  hazard_category: string | null;
  severity: string | null;
  ai_description: string | null;
  status: string;
  is_escalated?: boolean;
}

interface HazardsMapProps {
  hazards: MapHazard[];
  onSelectHazard?: (id: number) => void;
}

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    L: any;
  }
}

const SEVERITY_COLORS: Record<string, { fill: string; border: string; label: string }> = {
  'حرجة': { fill: '#ef4444', border: '#fecaca', label: 'حرجة' },
  'عالية': { fill: '#f97316', border: '#fed7aa', label: 'عالية' },
  'متوسطة': { fill: '#eab308', border: '#fef08a', label: 'متوسطة' },
  'منخفضة': { fill: '#22c55e', border: '#bbf7d0', label: 'منخفضة' },
};

export default function HazardsMap({ hazards, onSelectHazard }: HazardsMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clusterGroupRef = useRef<any>(null);
  const [scriptsLoaded, setScriptsLoaded] = useState(false);

  const geoHazards = hazards.filter(
    (h) =>
      typeof h.latitude === 'number' &&
      typeof h.longitude === 'number' &&
      !Number.isNaN(h.latitude) &&
      !Number.isNaN(h.longitude)
  );

  // Load Leaflet + MarkerCluster CSS & JS from CDN once
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const loadCss = (id: string, href: string) => {
      if (document.getElementById(id)) return;
      const link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      link.href = href;
      document.head.appendChild(link);
    };

    const loadScript = (id: string, src: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        const existing = document.getElementById(id) as HTMLScriptElement | null;
        if (existing) {
          if (existing.dataset.loaded === 'true') {
            resolve();
          } else {
            existing.addEventListener('load', () => resolve());
          }
          return;
        }
        const script = document.createElement('script');
        script.id = id;
        script.src = src;
        script.async = true;
        script.onload = () => {
          script.dataset.loaded = 'true';
          resolve();
        };
        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.body.appendChild(script);
      });
    };

    loadCss('leaflet-css', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css');
    loadCss('markercluster-css', 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css');
    loadCss('markercluster-default-css', 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css');

    let isMounted = true;
    loadScript('leaflet-js', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js')
      .then(() =>
        loadScript(
          'markercluster-js',
          'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js'
        )
      )
      .then(() => {
        if (isMounted) setScriptsLoaded(true);
      })
      .catch((err) => console.error('Map CDN load error:', err));

    return () => {
      isMounted = false;
    };
  }, []);

  // Initialize base map
  useEffect(() => {
    if (!scriptsLoaded || !mapContainerRef.current || mapInstanceRef.current) return;
    const L = window.L;
    if (!L) return;

    // Default center: Alexandria, Egypt (auto-fits to markers when available)
    const map = L.map(mapContainerRef.current, {
      center: [31.2001, 29.9187],
      zoom: 12,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      maxZoom: 19,
    }).addTo(map);

    const clusterGroup = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 45,
    });

    map.addLayer(clusterGroup);
    mapInstanceRef.current = map;
    clusterGroupRef.current = clusterGroup;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      clusterGroupRef.current = null;
    };
  }, [scriptsLoaded]);

  // Update markers whenever filtered hazards change
  useEffect(() => {
    if (!scriptsLoaded || !mapInstanceRef.current || !clusterGroupRef.current) return;
    const L = window.L;
    const map = mapInstanceRef.current;
    const clusterGroup = clusterGroupRef.current;

    clusterGroup.clearLayers();

    if (geoHazards.length === 0) return;

    const bounds: [number, number][] = [];

    geoHazards.forEach((hazard) => {
      const lat = hazard.latitude as number;
      const lng = hazard.longitude as number;
      bounds.push([lat, lng]);

      const sev = SEVERITY_COLORS[hazard.severity || 'منخفضة'] || SEVERITY_COLORS['منخفضة'];
      const isCritical = hazard.severity === 'حرجة';

      const iconHtml = `
        <div style="
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background-color: ${sev.fill};
          border: 3px solid #ffffff;
          box-shadow: 0 0 ${isCritical ? '14px' : '8px'} ${sev.fill};
          display: flex;
          align-items: center;
          justify-content: center;
          color: #ffffff;
          font-weight: 800;
          font-size: 11px;
          font-family: system-ui, sans-serif;
        ">
          ${hazard.id}
        </div>
      `;

      const customIcon = L.divIcon({
        html: iconHtml,
        className: 'salka-custom-pin',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -14],
      });

      const marker = L.marker([lat, lng], { icon: customIcon });

      const popupContent = document.createElement('div');
      popupContent.dir = 'rtl';
      popupContent.style.cssText =
        'font-family: system-ui, -apple-system, sans-serif; min-width: 220px; max-width: 260px; text-align: right; color: #0f172a;';

      popupContent.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <strong style="font-size:13px; color:#334155;">بلاغ #${hazard.id}</strong>
          <span style="background:${sev.fill}; color:#fff; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:700;">
            ${hazard.severity || 'منخفضة'}
          </span>
        </div>
        ${
          hazard.image_url
            ? `<img src="${hazard.image_url}" alt="صورة البلاغ" style="width:100%; height:110px; object-fit:cover; border-radius:8px; margin-bottom:8px;" />`
            : ''
        }
        <div style="font-weight:700; font-size:14px; margin-bottom:4px; color:#0f172a;">
          ${hazard.hazard_category || 'رصد بلدي عام'}
        </div>
        <div style="font-size:12px; color:#475569; margin-bottom:8px; line-height:1.4;">
          ${(hazard.ai_description || '').slice(0, 95)}${(hazard.ai_description || '').length > 95 ? '...' : ''}
        </div>
        <div style="font-size:11px; color:#64748b; margin-bottom:8px;">
          الحالة: <strong>${hazard.status}</strong>
        </div>
        <div style="display:flex; gap:6px;">
          <a href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}" target="_blank" rel="noopener noreferrer"
             style="flex:1; text-align:center; background:#0284c7; color:#fff; text-decoration:none; padding:6px 8px; border-radius:6px; font-size:12px; font-weight:600;">
            🧭 الاتجاهات
          </a>
          <button type="button" id="focus-card-${hazard.id}"
             style="flex:1; background:#1e293b; color:#fff; border:none; padding:6px 8px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer;">
            عرض البطاقة
          </button>
        </div>
      `;

      marker.bindPopup(popupContent);
      marker.on('popupopen', () => {
        const btn = document.getElementById(`focus-card-${hazard.id}`);
        if (btn && onSelectHazard) {
          btn.onclick = () => onSelectHazard(hazard.id);
        }
      });

      clusterGroup.addLayer(marker);
    });

    if (bounds.length === 1) {
      map.setView(bounds[0], 15);
    } else if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
  }, [scriptsLoaded, geoHazards, onSelectHazard]);

  return (
    <section style={styles.wrapper}>
      <div style={styles.mapHeader}>
        <div>
          <h2 style={styles.mapTitle}>🗺️ خريطة العمليات الجغرافية الحية (GIS)</h2>
          <p style={styles.mapSub}>
            عرض {geoHazards.length} بلاغ بإحداثيات GPS دقيقة (اضغط على أي دبوس للتفاصيل والتوجيه الميداني)
          </p>
        </div>

        <div style={styles.legend}>
          {Object.entries(SEVERITY_COLORS).map(([key, val]) => (
            <div key={key} style={styles.legendItem}>
              <span style={{ ...styles.legendDot, backgroundColor: val.fill }} />
              <span>{val.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={styles.mapBox}>
        {!scriptsLoaded && (
          <div style={styles.mapLoading}>جاري تحميل الخريطة التفاعلية والطبقات الجغرافية...</div>
        )}
        <div ref={mapContainerRef} style={styles.mapCanvas} />
      </div>
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '14px',
    padding: '18px',
    marginBottom: '24px',
  },
  mapHeader: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '14px',
  },
  mapTitle: {
    fontSize: '18px',
    fontWeight: 700,
    margin: '0 0 4px 0',
    color: '#f8fafc',
  },
  mapSub: {
    fontSize: '13px',
    color: '#94a3b8',
    margin: 0,
  },
  legend: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '12px',
    backgroundColor: '#0f172a',
    padding: '8px 14px',
    borderRadius: '10px',
    border: '1px solid #334155',
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    color: '#e2e8f0',
    fontWeight: 600,
  },
  legendDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    display: 'inline-block',
  },
  mapBox: {
    position: 'relative',
    width: '100%',
    height: '400px',
    borderRadius: '10px',
    overflow: 'hidden',
    border: '1px solid #334155',
    backgroundColor: '#0f172a',
  },
  mapCanvas: {
    width: '100%',
    height: '100%',
    zIndex: 1,
  },
  mapLoading: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#94a3b8',
    fontSize: '14px',
    zIndex: 2,
  },
};
