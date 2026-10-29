UUID := zenshot@local
DEST := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: schemas install uninstall pack test

schemas:
	glib-compile-schemas schemas

install: schemas
	mkdir -p $(DEST)
	cp -r extension.js metadata.json schemas $(DEST)/
	@echo "Installed to $(DEST)."
	@echo "On Wayland, log out and in, then: gnome-extensions enable $(UUID)"

uninstall:
	rm -rf $(DEST)

pack: schemas
	gnome-extensions pack --force --schema=schemas/org.gnome.shell.extensions.zenshot.gschema.xml .

test: schemas
	tests/run-headless.sh
