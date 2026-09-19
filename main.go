package main

import (
	"bytes"
	_ "embed"
	"errors"
	"flag"
	"fmt"
	"html"
	"io"
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"

	"gopkg.in/yaml.v3"
)

//go:embed web/index.html
var dashboardHTML string

//go:embed web/404.html
var notFoundHTML string

//go:embed web/robots.txt
var robotsTXT string

type AppConfig struct {
	Namespace string       `yaml:"namespace"`
	Path      string       `yaml:"path"`
	Static    StaticConfig `yaml:"static"`
}

type StaticConfig struct {
	Root string `yaml:"root"`
	SPA  bool   `yaml:"spa"`
}

type App struct {
	Prefix     string
	Namespace  string
	Path       string
	StaticRoot string
	SPA        bool
	Handler    http.Handler
}

type Router struct {
	Apps []App
}

const (
	rowsMarker  = "<!--apps-->"
	countMarker = "<!--count-->"
)

func main() {
	check := flag.Bool("check", false, "validate app configs and exit")
	flag.Parse()

	apps, errs := loadApps("./apps")

	for _, err := range errs {
		log.Print(err)
	}

	if *check {
		if len(errs) > 0 {
			os.Exit(1)
		}

		return
	}

	router := &Router{Apps: apps}

	log.Printf("loaded %d apps", len(apps))
	addr := ":" + port()

	log.Printf("listening on %s", addr)

	if err := http.ListenAndServe(addr, router); err != nil {
		log.Fatal(err)
	}
}

func port() string {
	if p := os.Getenv("PORT"); p != "" {
		return p
	}

	return "8080"
}

func loadApps(root string) ([]App, []error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, []error{err}
	}

	apps := make([]App, 0, len(entries))
	mounts := make(map[string]string, len(entries))
	var errs []error

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		appRoot := filepath.Join(root, entry.Name())
		configPath := filepath.Join(appRoot, "app.yaml")

		app, found, err := loadApp(appRoot, entry.Name())
		if err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", configPath, err))
			continue
		}

		if !found {
			continue
		}

		if prev, ok := mounts[app.Prefix]; ok {
			errs = append(errs, fmt.Errorf("%s: mount %s already used by %s", configPath, app.Prefix, prev))
			continue
		}

		mounts[app.Prefix] = configPath
		apps = append(apps, app)
	}

	return apps, errs
}

func loadApp(appRoot, dirName string) (App, bool, error) {
	data, err := os.ReadFile(filepath.Join(appRoot, "app.yaml"))
	if err != nil {
		if os.IsNotExist(err) {
			return App{}, false, nil
		}
		return App{}, false, err
	}

	var cfg AppConfig

	dec := yaml.NewDecoder(bytes.NewReader(data))
	dec.KnownFields(true)

	if err := dec.Decode(&cfg); err != nil && !errors.Is(err, io.EOF) {
		return App{}, false, err
	}

	if cfg.Namespace == "" {
		cfg.Namespace = dirName
	}

	if cfg.Static.Root == "" {
		cfg.Static.Root = "dist"
	}

	if err := cfg.validate(); err != nil {
		return App{}, false, err
	}

	staticRoot := filepath.Join(appRoot, cfg.Static.Root)

	rel, err := filepath.Rel(appRoot, staticRoot)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return App{}, false, fmt.Errorf("static root %q escapes the app directory", cfg.Static.Root)
	}

	info, err := os.Stat(staticRoot)
	if err != nil {
		return App{}, false, fmt.Errorf("static directory: %w", err)
	}

	if !info.IsDir() {
		return App{}, false, fmt.Errorf("static directory %s is not a directory", staticRoot)
	}

	mount := path.Join("/apps", cfg.Namespace)

	if cfg.Path != "" && cfg.Path != "/" {
		mount = path.Join(mount, cfg.Path)
	}

	var handler http.Handler

	if cfg.Static.SPA {
		handler = spaHandler(staticRoot)
	} else {
		handler = http.FileServer(http.Dir(staticRoot))
	}

	handler = guardFiles(staticRoot, handler)
	handler = http.StripPrefix(mount, handler)

	log.Printf(
		"namespace=%s path=%s root=%s spa=%t",
		cfg.Namespace,
		mount,
		staticRoot,
		cfg.Static.SPA,
	)

	return App{
		Prefix:     mount,
		Namespace:  cfg.Namespace,
		Path:       cfg.Path,
		StaticRoot: cfg.Static.Root,
		SPA:        cfg.Static.SPA,
		Handler:    handler,
	}, true, nil
}

func (c AppConfig) validate() error {
	if !validNamespace(c.Namespace) {
		return fmt.Errorf("invalid namespace %q", c.Namespace)
	}

	if !validPath(c.Path) {
		return fmt.Errorf("invalid path %q", c.Path)
	}

	return nil
}

func validNamespace(ns string) bool {
	if ns == "" || ns == "." || ns == ".." || len(ns) > 64 {
		return false
	}

	for _, r := range ns {
		if !strings.ContainsRune("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-", r) {
			return false
		}
	}

	return true
}

func validPath(p string) bool {
	if p == "" || p == "/" {
		return true
	}

	return strings.HasPrefix(p, "/") && !slices.Contains(strings.Split(p, "/"), "..")
}

func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	if req.URL.Path == "/robots.txt" {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		io.WriteString(w, robotsTXT)
		return
	}

	if req.URL.Path == "/" {
		r.serveDashboard(w, req)
		return
	}

	for i := range r.Apps {
		app := &r.Apps[i]

		if !matchesPrefix(req.URL.Path, app.Prefix) {
			continue
		}

		app.Handler.ServeHTTP(w, req)
		return
	}

	r.serveNotFound(w, req)
}

func (r *Router) serveNotFound(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusNotFound)

	if _, err := io.WriteString(w, notFoundHTML); err != nil {
		log.Printf("not found: %v", err)
	}
}

func (r *Router) serveDashboard(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet && req.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	page := strings.Replace(dashboardHTML, countMarker, fmt.Sprint(len(r.Apps)), 1)
	page = strings.Replace(page, rowsMarker, r.appRows(), 1)

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Robots-Tag", "noindex, nofollow")

	if _, err := io.WriteString(w, page); err != nil {
		log.Printf("dashboard: %v", err)
	}
}

func (r *Router) appRows() string {
	var rows strings.Builder

	for i := range r.Apps {
		app := &r.Apps[i]

		mount := html.EscapeString(app.Prefix)
		mode := "static"
		sub := app.Path

		if sub == "" {
			sub = "/"
		}

		if app.SPA {
			mode = "spa"
		}

		fmt.Fprintf(
			&rows,
			"<tr><td>%s</td><td><a href=\"%s\">%s</a></td><td class=\"dim\">%s</td>"+
				"<td class=\"col-root dim\">%s</td><td>%s</td></tr>",
			html.EscapeString(app.Namespace),
			mount,
			mount,
			html.EscapeString(sub),
			html.EscapeString(app.StaticRoot),
			mode,
		)
	}

	return rows.String()
}

func matchesPrefix(path, prefix string) bool {
	if prefix == "/" {
		return true
	}

	prefix = strings.TrimSuffix(prefix, "/")

	return path == prefix || strings.HasPrefix(path, prefix+"/")
}

// guardFiles blocks requests for config files and dotfiles. http.FileServer
// does none of this on its own, so an app whose root is "." would otherwise
// expose its app.yaml, .env and .git to anyone who guesses the path.
func guardFiles(root string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if blockedPath(r.URL.Path) {
			http.NotFound(w, r)
			return
		}

		// A directory with no index.html would be listed by FileServer; serve a
		// 404 instead of enumerating the app's files.
		if p := filepath.Join(root, filepath.FromSlash(filepath.Clean("/"+r.URL.Path))); !hasIndex(p) {
			if info, err := os.Stat(p); err == nil && info.IsDir() {
				http.NotFound(w, r)
				return
			}
		}

		next.ServeHTTP(w, r)
	})
}

func hasIndex(dir string) bool {
	for _, name := range []string{"index.html", "index.htm"} {
		if info, err := os.Stat(filepath.Join(dir, name)); err == nil && !info.IsDir() {
			return true
		}
	}

	return false
}

func blockedPath(p string) bool {
	for _, seg := range strings.Split(p, "/") {
		if seg == "app.yaml" {
			return true
		}

		// .well-known is a legitimate convention (ACME, OIDC); allow it.
		if len(seg) > 1 && strings.HasPrefix(seg, ".") && seg != ".well-known" {
			return true
		}
	}

	return false
}

func spaHandler(root string) http.Handler {
	files := http.FileServer(http.Dir(root))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cleanPath := filepath.Clean("/" + r.URL.Path)
		filePath := filepath.Join(root, filepath.FromSlash(cleanPath))

		info, err := os.Stat(filePath)

		if err == nil && !info.IsDir() {
			files.ServeHTTP(w, r)
			return
		}
		indexPath := filepath.Join(root, "index.html")

		if _, err := os.Stat(indexPath); err != nil {
			http.NotFound(w, r)
			return
		}

		http.ServeFile(w, r, indexPath)
	})
}
