package bridge

import (
	"fmt"
	"strings"

	"go.mau.fi/mautrix-meta/pkg/messagix/cookies"
	"go.mau.fi/mautrix-meta/pkg/messagix/types"
)

// ParseCookieString parses "k=v; k2=v2" (the format stored in fb_messenger_accounts.cookie)
// and checks that the cookies Facebook needs (xs, c_user, datr) are present.
func ParseCookieString(raw string) (map[cookies.MetaCookieName]string, error) {
	out := make(map[cookies.MetaCookieName]string)
	for _, part := range strings.Split(raw, ";") {
		k, v, ok := strings.Cut(strings.TrimSpace(part), "=")
		k, v = strings.TrimSpace(k), strings.TrimSpace(v)
		if !ok || k == "" || v == "" {
			continue
		}
		out[cookies.MetaCookieName(k)] = v
	}
	var missing []string
	for _, name := range cookies.FBRequiredCookies {
		if out[name] == "" {
			missing = append(missing, string(name))
		}
	}
	if len(missing) > 0 {
		return nil, fmt.Errorf("cookie thiếu: %s", strings.Join(missing, ", "))
	}
	return out, nil
}

func newFBCookies(values map[cookies.MetaCookieName]string) *cookies.Cookies {
	c := &cookies.Cookies{Platform: types.Facebook}
	c.UpdateValues(values)
	return c
}
