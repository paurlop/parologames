// Palco de Honor para Windows: el juego va incrustado en el ejecutable, se sirve en 127.0.0.1 con un
// puerto fijo (las partidas se guardan por dirección) y se muestra en una ventana WebView2 (el motor
// Edge que trae Windows 10/11). Si falta WebView2, se avisa y se abre el juego en el navegador.
//go:build windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
	"unsafe"

	"github.com/jchv/go-webview2"
)

func messageBox(text, title string) {
	user32 := syscall.NewLazyDLL("user32.dll")
	t, _ := syscall.UTF16PtrFromString(text)
	c, _ := syscall.UTF16PtrFromString(title)
	user32.NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), 0x40)
}

func fatal(msg string) {
	messageBox(msg, "Palco de Honor")
	os.Exit(1)
}

func dataDir() string {
	base := os.Getenv("APPDATA")
	if base == "" {
		base, _ = os.UserConfigDir()
	}
	d := filepath.Join(base, "PalcoDeHonor")
	_ = os.MkdirAll(d, 0o755)
	return d
}

func main() {
	l, port := listen()
	serve(l)
	url := "http://127.0.0.1:" + strconv.Itoa(port) + "/"

	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     false,
		AutoFocus: true,
		DataPath:  dataDir(),
		WindowOptions: webview2.WindowOptions{
			Title:  "Palco de Honor",
			Width:  1440,
			Height: 900,
			IconId: 1,
			Center: true,
		},
	})
	if w == nil {
		// Sin WebView2: el juego se abre en el navegador mientras esta ventana de aviso siga abierta.
		_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
		messageBox("Este equipo no tiene Microsoft Edge WebView2, así que Palco de Honor se ha abierto en tu navegador.\n\n"+
			"Deja esta ventana abierta mientras juegas y ciérrala al terminar.\n\n"+
			"Para jugar en su propia ventana, instala WebView2 Runtime desde la web de Microsoft.", "Palco de Honor")
		return
	}
	defer w.Destroy()
	w.Navigate(url)
	w.Run()
}
