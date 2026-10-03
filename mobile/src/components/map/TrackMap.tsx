import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';

import { colors } from '@/theme/tokens';

import { mapHtml, type MapData } from './mapHtml';

export function TrackMap({ data, style }: { data: MapData; style?: StyleProp<ViewStyle> }) {
  const ref = useRef<WebView>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (ready) ref.current?.injectJavaScript(`window.update(${JSON.stringify(data)}); true;`);
  }, [data, ready]);

  return (
    <View style={[styles.wrap, style]}>
      <WebView
        ref={ref}
        source={{ html: mapHtml }}
        originWhitelist={['*']}
        onLoadEnd={() => setReady(true)}
        style={{ backgroundColor: colors.bg }}
        // The page only renders tiles; it never needs to navigate away.
        onShouldStartLoadWithRequest={(r) => !r.url.startsWith('http')}
        setSupportMultipleWindows={false}
        javaScriptEnabled
        scrollEnabled={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', backgroundColor: colors.bg },
});
