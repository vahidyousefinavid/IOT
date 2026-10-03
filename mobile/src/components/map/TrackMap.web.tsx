import { useEffect, useRef, useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '@/theme/tokens';

import { mapHtml, type MapData } from './mapHtml';

/** Web preview: the same Leaflet page in a sandboxed iframe. */
export function TrackMap({ data, style }: { data: MapData; style?: StyleProp<ViewStyle> }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source === ref.current?.contentWindow && e.data?.type === 'map-ready') setReady(true);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  useEffect(() => {
    if (ready) ref.current?.contentWindow?.postMessage({ type: 'update', data }, '*');
  }, [data, ready]);

  return (
    <View style={[{ overflow: 'hidden', backgroundColor: colors.bg }, style]}>
      <iframe
        ref={ref}
        srcDoc={mapHtml}
        sandbox="allow-scripts"
        style={{ border: 0, width: '100%', height: '100%', background: colors.bg }}
        title="map"
      />
    </View>
  );
}
