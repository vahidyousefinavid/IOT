# Template: docker-compose renders this into /opt/emqx/etc/base.hocon at
# container start, replacing __INTERNAL_TOKEN__ (EMQX HOCON does not read
# arbitrary environment variables).

# Every MQTT client is authenticated and authorised by the Hooshban API.
# Devices get one username/secret each and may only use their own topic root.

authentication = [
  {
    mechanism = password_based
    backend = http
    enable = true
    method = post
    url = "http://api:9090/internal/mqtt/authn"
    body {
      username = "${username}"
      password = "${password}"
      clientid = "${clientid}"
    }
    headers {
      "content-type" = "application/json"
      "X-Internal-Token" = "__INTERNAL_TOKEN__"
    }
    request_timeout = 5s
  }
]

authorization {
  no_match = deny
  deny_action = disconnect
  cache {
    enable = true
    max_size = 64
    ttl = 5m
  }
  sources = [
    {
      type = http
      enable = true
      method = post
      url = "http://api:9090/internal/mqtt/authz"
      body {
        username = "${username}"
        topic = "${topic}"
        action = "${action}"
      }
      headers {
        "content-type" = "application/json"
        "X-Internal-Token" = "__INTERNAL_TOKEN__"
      }
      request_timeout = 5s
    }
  ]
}

mqtt {
  max_packet_size = 256KB
  max_clientid_len = 128
  max_topic_levels = 16
}
