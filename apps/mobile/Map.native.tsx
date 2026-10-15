import { useEffect, useMemo, useState } from "react";
import { View, Text } from "react-native";
import { WebView } from "react-native-webview";
import { request } from "./session";
type Point = { lat: number; lng: number; label?: string };
const safeJson = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
export default function Map({
  points = [],
  route = [],
}: {
  points?: Point[];
  route?: number[][];
}) {
  const [token, setToken] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    request<{ token: string }>("/maps/config")
      .then((config) => {
        if (!config.token?.startsWith("pk."))
          throw Error("El token público de Mapbox no está configurado.");
        if (mounted) setToken(config.token);
      })
      .catch((e) => mounted && setError(e.message));
    return () => {
      mounted = false;
    };
  }, []);
  const html = useMemo(() => {
    const validPoints = points
      .filter(
        (p) =>
          Number.isFinite(p.lat) &&
          Math.abs(p.lat) <= 90 &&
          Number.isFinite(p.lng) &&
          Math.abs(p.lng) <= 180,
      )
      .map((p) => [p.lng, p.lat]);
    const validRoute = route.filter(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        Number.isFinite(p[0]) &&
        Number.isFinite(p[1]) &&
        Math.abs(p[0]) <= 180 &&
        Math.abs(p[1]) <= 90,
    );
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src https://api.mapbox.com 'unsafe-inline' 'unsafe-eval' blob:; style-src https://api.mapbox.com 'unsafe-inline'; img-src https://api.mapbox.com https://*.mapbox.com data: blob:; connect-src https://api.mapbox.com https://*.mapbox.com; worker-src blob:; font-src https://api.mapbox.com; base-uri 'none'; form-action 'none'"><link href="https://api.mapbox.com/mapbox-gl-js/v3.16.0/mapbox-gl.css" rel="stylesheet"><style>html,body,#map{margin:0;height:100%;width:100%}#status{position:absolute;top:8px;left:8px;padding:8px;background:white;font:14px sans-serif;z-index:3}</style></head><body><div id="map"></div><div id="status">Cargando Mapbox…</div><script src="https://api.mapbox.com/mapbox-gl-js/v3.16.0/mapbox-gl.js"></script><script>document.addEventListener('click',event=>{if(event.target.closest&&event.target.closest('a')){event.preventDefault();event.stopImmediatePropagation()}},true);window.open=()=>null;const points=${safeJson(validPoints)};const route=${safeJson(validRoute)};try{const map=new mapboxgl.Map({container:'map',accessToken:${safeJson(token)},style:'mapbox://styles/mapbox/light-v11',center:points[0]||[0,0],zoom:points.length?13:1,attributionControl:true});map.addControl(new mapboxgl.NavigationControl());points.forEach(p=>new mapboxgl.Marker().setLngLat(p).addTo(map));map.on('load',()=>{document.getElementById('status').remove();if(route.length>1){map.addSource('route',{type:'geojson',data:{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:route}}});map.addLayer({id:'route',type:'line',source:'route',paint:{'line-color':'#c59a00','line-width':5}})}const all=route.length?route:points;if(all.length){const bounds=new mapboxgl.LngLatBounds();all.forEach(p=>bounds.extend(p));map.fitBounds(bounds,{padding:40,maxZoom:15})}});map.on('error',()=>{let status=document.getElementById('status');if(!status){status=document.createElement('div');status.id='status';document.body.appendChild(status)}status.textContent='Mapbox no está disponible. Revisa la conexión.'})}catch(e){document.getElementById('status').textContent='No pudimos cargar Mapbox.'}</script></body></html>`;
  }, [token, JSON.stringify(points), JSON.stringify(route)]);
  return (
    <View
      style={{
        height: 260,
        borderRadius: 20,
        overflow: "hidden",
        backgroundColor: "#eceee7",
      }}
    >
      {error ? (
        <Text accessibilityRole="alert" style={{ padding: 24 }}>
          {error}
        </Text>
      ) : token ? (
        <WebView
          source={{ html }}
          originWhitelist={["about:blank"]}
          onShouldStartLoadWithRequest={(navigation) =>
            navigation.url === "about:blank"
          }
          javaScriptEnabled
          domStorageEnabled={false}
          setSupportMultipleWindows={false}
          onOpenWindow={() => {}}
          javaScriptCanOpenWindowsAutomatically={false}
          mixedContentMode="never"
          allowFileAccess={false}
          allowUniversalAccessFromFileURLs={false}
          onError={() => setError("No pudimos cargar el mapa de Mapbox.")}
          accessibilityLabel="Mapa Mapbox con ruta y ubicaciones reales"
        />
      ) : (
        <Text style={{ padding: 24 }}>Cargando mapa…</Text>
      )}
    </View>
  );
}
