UUID := zenshot@local
DEST := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: schemas install uninstall pack test

schemas:
	glib-compile-schemas schemas

install: schemas
	mkdir -p $(DEST)
	cp -r extension.js metadata.json schemas $(DEST)/
	@if gnome-extensions disable $(UUID) 2>/dev/null && gnome-extensions enable $(UUID); then \
		echo "Reloaded $(UUID)."; \
	else \
		list=$$(gsettings get org.gnome.shell enabled-extensions); \
		echo "$$list" | grep -q "'$(UUID)'" || gsettings set org.gnome.shell enabled-extensions \
			"$$(echo "$$list" | sed "s/]$$/, '$(UUID)']/; s/\[, /[/")"; \
		echo "Installed and enabled $(UUID). First install: log out and back in once to load it."; \
	fi

uninstall:
	rm -rf $(DEST)

pack: schemas
	gnome-extensions pack --force --schema=schemas/org.gnome.shell.extensions.zenshot.gschema.xml .

test: schemas
	tests/run-headless.sh
