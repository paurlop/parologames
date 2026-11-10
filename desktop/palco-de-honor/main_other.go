//go:build !windows

// Versión de prueba para Linux/macOS: solo sirve el juego incrustado y muestra la dirección.
package main

import (
	"fmt"
	"strconv"
)

func main() {
	l, port := listen()
	serve(l)
	fmt.Println("http://127.0.0.1:" + strconv.Itoa(port) + "/")
	select {}
}
