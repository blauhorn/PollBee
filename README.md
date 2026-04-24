🎺 PollBee – Umfragen für Ensembles (Nextcloud Polls Companion)

PollBee ist eine Progressive Web App (PWA) für die komfortable Nutzung von Nextcloud-Umfragen – optimiert für Bands, Ensembles und Orchester.

Ziel: Schnell sehen, wer kann – und wo es eng wird.

✨ Features
📊 Umfragen-Übersicht
Anzeige aller offenen und abgeschlossenen Umfragen
Farblich unterschieden für bessere Orientierung
Offene (noch nicht beantwortete) Umfragen ganz oben
Erinnerungspunkt auf der Karte:
erscheint, wenn du noch nicht vollständig abgestimmt hast
🧾 Kompakte Zusammenfassung

Jede Umfrage zeigt auf einen Blick:

Stimmen pro Option (Ja / Nein / Vielleicht)
Anzahl fehlender Antworten
➕ Neue Umfrage erstellen
Über den blauen „+“-Button unten rechts
Jede Person kann Umfragen erstellen
Der Ersteller ist automatisch verantwortlich für:
Bearbeiten
Beenden / Wiederöffnen
Weiterverarbeitung (z. B. Kalender)
📅 Detailansicht

Hier passiert die eigentliche Abstimmung:

Abstimmung pro Terminoption:
✅ Ja
❌ Nein
❓ Vielleicht (falls aktiviert)
Speicherung über den blauen Haken

Einschränkungen:

Abstimmung nur möglich, wenn:
Umfrage noch offen ist
Termin nicht zu weit in der Vergangenheit liegt (aktuell ~4 Tage Toleranz)
👥 Gruppen-/Register-Ansicht

Ein zentrales Feature für die Organisation von Ensembles:

👉 Klick auf eine Terminoption zeigt:

Aufschlüsselung nach frei definierbaren Gruppen (z. B. Register, Stimmen, Teams)

➡️ Damit erkennst du sofort:

Wo Besetzungsprobleme entstehen
Ob Ersatz organisiert werden muss

Konfiguration:

Erfolgt serverseitig in register_config.py
Jede Gruppe ist einer groupId zugeordnet
Diese groupId muss mit den Nutzergruppen in der Nextcloud-Instanz übereinstimmen

➡️ Dadurch ist PollBee flexibel einsetzbar für:

Bigbands
Orchester
kleinere Bands
beliebige Teamstrukturen
🛠️ Funktionen für Umfrage-Ersteller

Eigene Umfragen bieten zusätzliche Steuerung:

🔒 Beenden
🔓 Wieder öffnen
📆 In Kalender übernehmen
Status pro Option setzen:
ANFRAGE
FIX
CANCELED
🔗 Teilen von Umfragen
Jede Umfrage kann geteilt werden (System-Share)
Der Link:
öffnet direkt PollBee (wenn installiert)
sonst den Browser

💡 Ideal für:

Erinnerungen an säumige Teilnehmer
Schnelles Nachfassen
💬 Kommentare
Kommentar-Button öffnet aktuell die Umfrage in Nextcloud (Browser)
Direkte Integration in PollBee ist derzeit technisch nicht möglich
🔐 Login & Installation (PWA)
Login-Flow

Beim ersten Zugriff:

App öffnet Login im zweiten Browser-Tab
Anmeldung bei Nextcloud
Berechtigung erteilen
Tab schließen → zurück zur App

Funktioniert stabil auf:

Desktop
Android
iOS
📱 Installation als App

Android (Chrome):

„Zum Startbildschirm hinzufügen“

iOS (Safari):

„Zum Home-Bildschirm“
⚙️ Installation & Server-Setup

PollBee besteht aus:

Backend (API / Proxy)
Frontend (PWA)
🐳 Beispiel: Docker Compose
version: "3.9"

services:
  pollapp-backend:
    build: ./backend
    container_name: pollapp-backend
    restart: unless-stopped
    env_file:
      - .env

  pollapp-frontend:
    build: ./frontend
    container_name: pollapp-frontend
    restart: unless-stopped
    ports:
      - "127.0.0.1:8100:8100"
    depends_on:
      - pollapp-backend
    environment:
      VITE_NEXTCLOUD_BASE_URL: ${VITE_NEXTCLOUD_BASE_URL}
🔧 Konfiguration (.env)

Die zentrale Konfiguration erfolgt über die .env-Datei.

Beispiel:
# Basis-URL deiner Nextcloud
NEXTCLOUD_BASE_URL=https://cloud.example.com

# Öffentliche URL der PollBee API (für Redirects / Login-Flow)
PUBLIC_BASE_URL=https://pollbee.example.com

# Secret für interne Auth-/State-Validierung
APP_SECRET=change-me

# CORS / erlaubte Hosts (optional)
ALLOWED_ORIGINS=https://pollbee.example.com
Wichtige Hinweise
NEXTCLOUD_BASE_URL muss auf die erreichbare Nextcloud zeigen
HTTPS wird dringend empfohlen (Login-Flow!)
Reverse Proxy (nginx etc.) sollte korrekt konfiguriert sein
Cookies / Session müssen durchgereicht werden
🧠 Idee hinter PollBee

PollBee ergänzt Nextcloud Polls um:

bessere Übersicht
schnellere Entscheidungsfähigkeit
gruppenbasierte Auswertung

➡️ Fokus: Organisation statt Suchen

🚧 Bekannte Einschränkungen
Kommentare nur über das Nextcloud-Webinterface verfügbar
Gruppen-/Registerdarstellung setzt voraus, dass:
passende Gruppen in der Nextcloud existieren
die groupId-Einträge in register_config.py korrekt darauf abgebildet sind
➜ keine automatische Synchronisation oder Discovery der Gruppen
🔮 Roadmap (optional)
Automatische Erkennung und Synchronisation von Nextcloud-Gruppen
Vereinfachte Konfiguration der Gruppen (z. B. UI statt Datei)
Push-Benachrichtigungen bei neuen Umfragen
Erweiterte Kalenderfunktionen