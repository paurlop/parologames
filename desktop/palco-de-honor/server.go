// Parte común: el juego incrustado y el servidor local en 127.0.0.1 con puerto fijo.
package main

import (
	"embed"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"strconv"
	"time"
)

//go:embed game
var gameFS embed.FS

// Puertos fijos por orden: el primero libre se usa siempre, así el navegador interno conserva las partidas.
var ports = []int{47821, 47822, 47823, 47824, 47825}

func listen() (net.Listener, int) {
	for _, p := range ports {
		if l, err := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(p)); err == nil {
			return l, p
		}
	}
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		panic("No se pudo arrancar el juego: " + err.Error())
	}
	return l, l.Addr().(*net.TCPAddr).Port
}

func serve(l net.Listener) {
	sub, _ := fs.Sub(gameFS, "game")
	_ = mime.AddExtensionType(".woff2", "font/woff2")
	_ = mime.AddExtensionType(".js", "text/javascript; charset=utf-8")
	files := http.FileServer(http.FS(sub))
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Solo esta máquina, y sin caché entre versiones del juego.
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		files.ServeHTTP(w, r)
	})
	srv := &http.Server{Handler: h, ReadHeaderTimeout: 10 * time.Second}
	go srv.Serve(l)
}
