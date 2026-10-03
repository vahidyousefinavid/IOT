#!/usr/bin/env sh
# Creates the Android upload key that signs every release, and prints the
# values to store as GitHub secrets. Uses a local JDK's keytool, or Docker.
#
# KEEP secrets/android/ BACKED UP OFFLINE: without this key you can never
# publish an update to the same app again. It is git-ignored on purpose.
set -eu
dir="secrets/android"
mkdir -p "$dir"
[ -f "$dir/upload.jks" ] && { echo "$dir/upload.jks already exists; refusing to overwrite"; exit 1; }

pass="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-32)"
alias="hooshban-upload"
dname="CN=Hooshban, O=Hooshban, C=IR"

if command -v keytool >/dev/null 2>&1; then
  keytool -genkeypair -v -storetype PKCS12 -keystore "$dir/upload.jks" -alias "$alias" \
    -keyalg RSA -keysize 4096 -validity 10000 -storepass "$pass" -keypass "$pass" -dname "$dname"
else
  docker run --rm -v "$(pwd)/$dir:/out" eclipse-temurin:17-jre \
    keytool -genkeypair -storetype PKCS12 -keystore /out/upload.jks -alias "$alias" \
    -keyalg RSA -keysize 4096 -validity 10000 -storepass "$pass" -keypass "$pass" -dname "$dname"
fi

base64 < "$dir/upload.jks" | tr -d '\n' > "$dir/upload.jks.base64"
cat > "$dir/github-secrets.txt" <<EOF
ANDROID_KEYSTORE_BASE64   = (contents of $dir/upload.jks.base64)
ANDROID_KEYSTORE_PASSWORD = $pass
ANDROID_KEY_ALIAS         = $alias
ANDROID_KEY_PASSWORD      = $pass
EOF
chmod 600 "$dir"/* 2>/dev/null || true
echo "Key created. GitHub secrets are listed in $dir/github-secrets.txt"
