package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// newSPARoot builds a fake Vite-style dist: hashed assets plus a shell.
func newSPARoot(t *testing.T) string {
	t.Helper()

	root := t.TempDir()
	write := func(rel, body string) {
		t.Helper()
		p := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	write("index.html", "<!doctype html><div id=root></div>")
	write("assets/index-abc123.js", "console.log(1)")
	write("assets/index-abc123.css", "body{}")
	write("assets/logo-xyz.svg", "<svg/>")
	write("favicon.svg", "<svg/>")
	write("robots.txt", "User-agent: *")
	write("manifest.webmanifest", "{}")

	return root
}

func serve(t *testing.T, root, target string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(http.MethodGet, target, nil)
	rec := httptest.NewRecorder()
	spaHandler(root).ServeHTTP(rec, req)

	return rec
}

func TestSPAServesExistingFiles(t *testing.T) {
	root := newSPARoot(t)

	for _, target := range []string{
		"/",
		"/assets/index-abc123.js",
		"/assets/index-abc123.css",
		"/favicon.svg",
		// public/ files land at the root, outside /assets/. They must still be
		// served from disk even though .txt/.svg are asset extensions.
		"/robots.txt",
		"/manifest.webmanifest",
	} {
		if rec := serve(t, root, target); rec.Code != http.StatusOK {
			t.Errorf("%s: got %d, want 200", target, rec.Code)
		}
	}
}

func TestSPAFallbackForNavigations(t *testing.T) {
	root := newSPARoot(t)

	// Real router paths have no extension and must get the shell.
	for _, target := range []string{"/", "/leagues", "/leagues/123/team/4", "/settings"} {
		rec := serve(t, root, target)
		if rec.Code != http.StatusOK {
			t.Errorf("%s: got %d, want 200", target, rec.Code)
		}
		if got := rec.Body.String(); got != "<!doctype html><div id=root></div>" {
			t.Errorf("%s: did not serve shell, got %q", target, got)
		}
	}
}

// The regression this guards: a stale client holding a pre-deploy hashed asset
// must get a 404, not index.html with a 200. Returning HTML here makes the
// browser eval markup as JavaScript ("Unexpected token '<'").
func TestSPAMissingAssetsAre404NotShell(t *testing.T) {
	root := newSPARoot(t)

	for _, target := range []string{
		"/assets/index-STALE1.js",
		"/assets/index-STALE1.css",
		"/assets/chunk-OLD.js",
		"/missing.svg",
		"/data.json",
		"/deep/nested/thing.js",
	} {
		rec := serve(t, root, target)
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s: got %d, want 404", target, rec.Code)
		}
		if got := rec.Body.String(); got == "<!doctype html><div id=root></div>" {
			t.Errorf("%s: served SPA shell for a missing asset", target)
		}
	}
}

func TestSPAMissingDirectoryIs404(t *testing.T) {
	root := newSPARoot(t)

	// A path that exists as a directory but has no index.html is not a route the
	// shell can satisfy, and must not be enumerated by FileServer.
	if rec := serve(t, root, "/assets/"); rec.Code != http.StatusNotFound {
		t.Errorf("/assets/: got %d, want 404", rec.Code)
	}
}

func TestSPANoIndexMeans404(t *testing.T) {
	root := t.TempDir()

	if rec := serve(t, root, "/anything"); rec.Code != http.StatusNotFound {
		t.Errorf("got %d, want 404 when index.html is absent", rec.Code)
	}
}

// A dotted final segment with an unknown extension is still a route: apps may
// legitimately have usernames or version strings containing dots.
func TestSPADottedSegmentIsNavigation(t *testing.T) {
	root := newSPARoot(t)

	for _, target := range []string{"/user/cmchi", "/v1.2/notes"} {
		if rec := serve(t, root, target); rec.Code != http.StatusOK {
			t.Errorf("%s: got %d, want shell 200", target, rec.Code)
		}
	}
}

func TestIsNavigation(t *testing.T) {
	cases := []struct {
		path string
		want bool
	}{
		{"/", true},
		{"/leagues", true},
		{"/leagues/1", true},
		{"/assets/", false},
		{"/assets/x.js", false},
		{"/x.JS", false},      // extension match is case-insensitive
		{"/x.js", false},      // dotted last segment
		{"/v1.2/route", true}, // dot is not in the last segment
	}

	for _, c := range cases {
		req := httptest.NewRequest(http.MethodGet, c.path, nil)
		if got := isNavigation(req, c.path); got != c.want {
			t.Errorf("isNavigation(%q) = %t, want %t", c.path, got, c.want)
		}
	}
}
