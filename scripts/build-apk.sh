#!/usr/bin/env bash
# Builds a signed Android APK locally inside Docker — no Android Studio, JDK
# or SDK on the host. Works from Iran: Google's Maven/Gradle hosts are
# replaced by the Aliyun/Tencent mirrors.
#
#   API_URL=http://1.2.3.4:8080 [VARIANT=preview] [GT06_PORT=5023] scripts/build-apk.sh
#
# Output: dist/hooshban-<version>-<variant>.apk
# Signs with secrets/android/upload.jks if present (scripts/gen-android-key.sh).
set -euo pipefail
cd "$(dirname "$0")/.."

: "${API_URL:?set API_URL, e.g. http://95.38.186.215:8080}"
VARIANT="${VARIANT:-preview}"
VERSION="$(cat VERSION)"
IMAGE="reactnativecommunity/react-native-android:v21.1"
HOST="$(printf '%s' "$API_URL" | sed -E 's#^[a-z]+://([^:/]+).*#\1#')"

mkdir -p dist
key_env=()
if [ -f secrets/android/upload.jks ]; then
  pass="$(grep ANDROID_KEYSTORE_PASSWORD secrets/android/github-secrets.txt | awk '{print $3}')"
  key_env=(-e HOOSHBAN_KEYSTORE=/keys/upload.jks -e HOOSHBAN_KEYSTORE_PASSWORD="$pass"
           -e HOOSHBAN_KEY_ALIAS=hooshban-upload -e HOOSHBAN_KEY_PASSWORD="$pass")
fi

# DETACH=1 runs the build as a background container (survives closing the
# terminal); follow it with `docker logs -f hooshban-apk-build`.
run_flags=(--rm)
if [ "${DETACH:-0}" = 1 ]; then
  docker rm -f hooshban-apk-build >/dev/null 2>&1 || true
  run_flags=(-d --name hooshban-apk-build)
fi

MSYS_NO_PATHCONV=1 docker run "${run_flags[@]}" \
  -v "$(pwd)/mobile:/src/mobile:ro" -v "$(pwd)/VERSION:/src/VERSION:ro" \
  -v "$(pwd)/secrets/android:/keys:ro" -v "$(pwd)/dist:/out" \
  -v hooshban-gradle-home:/opt/gradle-home -v hooshban-npm-cache:/root/.npm -v hooshban-sdk-cache:/sdkcache \
  -e APP_VARIANT="$VARIANT" -e EXPO_PUBLIC_API_URL="$API_URL" \
  -e EXPO_PUBLIC_MQTT_HOST="${MQTT_HOST:-$HOST}" -e EXPO_PUBLIC_TRACKER_HOST="${TRACKER_HOST:-$HOST}" \
  -e EXPO_PUBLIC_GT06_PORT="${GT06_PORT:-5023}" -e EXPO_PUBLIC_H02_PORT="${H02_PORT:-5013}" \
  -e VERSION="$VERSION" -e NODE_OPTIONS=--max-old-space-size=3072 -e ABIS="${ABIS:-arm64-v8a}" \
  ${HTTPS_PROXY_FOR_BUILD:+-e HTTPS_PROXY="$HTTPS_PROXY_FOR_BUILD" -e HTTP_PROXY="$HTTPS_PROXY_FOR_BUILD"} \
  "${key_env[@]}" \
  "$IMAGE" bash -euo pipefail -c '
    mkdir -p /work && cp /src/VERSION /work/
    tar -C /src/mobile --exclude=node_modules --exclude=android --exclude=ios --exclude=.expo -cf - . | (mkdir -p /work/mobile && tar -C /work/mobile -xf -)
    # SDK packages the project and its libraries require, from the Tencent
    # mirror of the Google repository (dl.google.com is blocked from Iran).
    sdk_get() {
      [ -d "$ANDROID_HOME/$2" ] && return 0
      # Cached across builds; resumed and retried because links drop mid-transfer.
      if ! unzip -tq "/sdkcache/$1" >/dev/null 2>&1; then
        for i in 1 2 3 4 5 6; do
          curl -fsSL --retry 5 --retry-all-errors -C - "https://mirrors.cloud.tencent.com/AndroidSDK/$1" -o "/sdkcache/$1" \
            && unzip -tq "/sdkcache/$1" >/dev/null && break
          echo "download of $1 interrupted, retry $i"; sleep 3
        done
      fi
      rm -rf /tmp/pkg && mkdir -p /tmp/pkg && unzip -q "/sdkcache/$1" -d /tmp/pkg
      mkdir -p "$(dirname "$ANDROID_HOME/$2")"
      # Most packages unzip to one folder; some (cmake) to several entries.
      if [ "$(ls /tmp/pkg | wc -l)" = 1 ]; then mv /tmp/pkg/* "$ANDROID_HOME/$2"
      else mkdir -p "$ANDROID_HOME/$2" && mv /tmp/pkg/* "$ANDROID_HOME/$2/"; fi
      echo "installed $2"
    }
    sdk_get build-tools_r35_linux.zip build-tools/35.0.0
    sdk_get build-tools_r36_linux.zip build-tools/36.0.0
    sdk_get platform-35_r02.zip platforms/android-35
    sdk_get platform-36_r02.zip platforms/android-36
    sdk_get cmake-3.22.1-linux.zip cmake/3.22.1

    cd /work/mobile
    npm i -g npm@11 --no-audit --no-fund --loglevel=error
    for i in 1 2 3; do npm ci --no-audit --no-fund --loglevel=error && break; echo "npm ci failed, retry $i"; sleep 5; done
    [ -d node_modules/expo ]
    npx expo prebuild --platform android --no-install --clean

    # Mirrors for hosts that are blocked from Iran.
    sed -i "s#https\\\\://services.gradle.org/distributions/#https\\\\://mirrors.cloud.tencent.com/gradle/#" android/gradle/wrapper/gradle-wrapper.properties
    # Point every google() repository (including Gradle builds bundled in
    # node_modules, which init scripts do not reach) at the Aliyun mirror.
    find android node_modules -type f \( -name "*.gradle" -o -name "*.gradle.kts" \) -print0 \
      | xargs -0 grep -l "google()" \
      | xargs -r sed -i "s#google()#maven { url = uri(\"https://maven.aliyun.com/repository/google\"); content { includeGroupAndSubgroups(\"androidx\"); includeGroupAndSubgroups(\"com.android\"); includeGroupAndSubgroups(\"com.google.android\"); includeGroupAndSubgroups(\"com.google.firebase\"); includeGroupAndSubgroups(\"com.google.gms\"); includeGroupAndSubgroups(\"com.google.mlkit\"); includeGroupAndSubgroups(\"com.google.ar\"); includeGroupAndSubgroups(\"com.google.testing\"); includeGroupAndSubgroups(\"com.google.devtools\"); includeGroupAndSubgroups(\"com.google.prefab\") } }#g"
    echo "google() repositories left: $(find android node_modules -type f \( -name "*.gradle" -o -name "*.gradle.kts" \) -print0 | xargs -0 grep -l "google()" | wc -l)"
    mkdir -p "$GRADLE_USER_HOME/init.d"
    cat > "$GRADLE_USER_HOME/init.d/mirrors.gradle" <<"EOF"
def mirrors = [
  "dl.google.com"          : "https://maven.aliyun.com/repository/google",
  "maven.google.com"       : "https://maven.aliyun.com/repository/google",
]
def rewrite = { repos ->
  repos.configureEach { r ->
    if (r instanceof MavenArtifactRepository) {
      def m = mirrors.find { host, _ -> r.url.toString().contains(host) }
      if (m) r.url = m.value
      // The Google mirror answers 502 (not 404) for artifacts it does not
      // host, and Gradle then disables the whole repository. Only ask it
      // for Google groups; everything else comes from Maven Central.
      if (r.url.toString().contains("maven.aliyun.com/repository/google")) {
        r.content { includeGroupByRegex "(com\\.android|androidx|com\\.google\\.android|com\\.google\\.firebase|com\\.google\\.gms|com\\.google\\.mlkit|com\\.google\\.ar|com\\.google\\.testing|com\\.google\\.devtools|com\\.google\\.prefab|com\\.google\\.jetpackcamera)(\\..*)?" }
      }
    }
  }
}
beforeSettings { s -> rewrite(s.pluginManagement.repositories); rewrite(s.dependencyResolutionManagement.repositories) }
allprojects { rewrite(buildscript.repositories); rewrite(repositories) }
EOF

    cd android
    # Flaky links: long timeouts, and retry (downloads resume from the cache).
    export GRADLE_OPTS="-Dorg.gradle.internal.http.connectionTimeout=120000 -Dorg.gradle.internal.http.socketTimeout=120000 -Dorg.gradle.internal.network.retry.max.attempts=5"
    ok=0
    # arm64-v8a covers practically every phone in use; building all four ABIs
    # quadruples the C++ work and memory. ABIS=armeabi-v7a,arm64-v8a for old phones.
    for i in 1 2 3; do
      ./gradlew --no-daemon -q --max-workers=2 assembleRelease \
        -PreactNativeArchitectures="${ABIS:-arm64-v8a}" "-Dorg.gradle.jvmargs=-Xmx3g -XX:MaxMetaspaceSize=768m" \
        && ok=1 && break
      echo "gradle failed, retry $i"
    done
    [ "$ok" = 1 ]
    cp app/build/outputs/apk/release/app-release.apk "/out/hooshban-$VERSION-$APP_VARIANT.apk"
  '

apk="dist/hooshban-$VERSION-$VARIANT.apk"
if [ "${DETACH:-0}" = 1 ]; then
  echo "Building in background container hooshban-apk-build; output: $apk"
else
  echo "Built $apk ($(du -h "$apk" | cut -f1))"
fi
