# PollBee – Nextcloud Polls Web App

PollBee ist eine moderne Web-App zur komfortablen Nutzung von Nextcloud Polls.
Sie richtet sich insbesondere an Gruppen wie Bands oder Teams, die schnell und übersichtlich Abstimmungen durchführen möchten.

Die Anwendung bietet eine optimierte Oberfläche für:

* schnelle Übersicht über Umfragen
* strukturierte Darstellung von Abstimmungen
* komfortables Abstimmen (inkl. Register-Logik)
* personalisierte Darstellung pro Nutzer

---

## 🚀 Features

### 🔐 Login Flow v2 (Nextcloud Standard)

* Login erfolgt über den offiziellen Nextcloud Login Flow
* keine Speicherung von Benutzerpasswörtern
* Verwendung von App-Passwörtern (revokable)
* funktioniert auch auf mobilen Geräten

---

### 📊 Umfragenübersicht (PollList)

* kompakte Kartenansicht aller Umfragen

* intelligente Sortierung:

  * offene Umfragen mit fehlenden Antworten ganz oben

* farbliche Hervorhebung:

  * 🟧 offen mit fehlenden Antworten
  * 🟩 offen, vollständig beantwortet
  * 🟦 abgeschlossen
  * ⚪ vergangene Umfragen (gedimmte Darstellung)

* Badge für offene Antworten („offen“)

* persönlicher Begrüßungstext (tageszeitabhängig)

* Anzeige offener Umfragen für den aktuellen Nutzer

---

### 🔍 Filter & Suche

* Textfilter (Titel, Beschreibung)
* Datumsfilter (von/bis)
* kompakte, einklappbare Filteransicht

---

### 📋 Detailansicht

* tabellarische Darstellung der Optionen
* Stimmen nach:

  * Ja / Nein / Vielleicht / Fehlt
* Akkordeon-Ansicht pro Option
* Gruppierung nach Registern (z. B. Band-Sektionen)
* Hervorhebung des eigenen Namens

---

### 🗳️ Abstimmung

* direkte Stimmabgabe pro Option
* Unterstützung für:

  * Ja
  * Nein
  * Vielleicht
* sofortige Aktualisierung der Ansicht

---

## 🏗️ Architektur

### Frontend

* React + TypeScript
* Vite
* einfache Inline-Styling-Strategie (keine UI-Framework-Abhängigkeit)

### Backend

* FastAPI
* Session-basierte Authentifizierung
* Proxy für Nextcloud API

### Integration

* Nextcloud Polls API
* Login Flow v2 (`/index.php/login/v2`)
* Vote-Endpoint (`PUT /apps/polls/vote`)

---

## 🔧 Setup

### Voraussetzungen

* Docker + Docker Compose
* Nextcloud-Instanz mit aktivierter Polls-App

---

### Projekt starten

```bash
docker compose up --build
```

Frontend ist anschließend erreichbar unter:

```
http://localhost:8080
```

---

## 🔑 Login

1. Server-URL eingeben (z. B. `https://cloud.example.com`)
2. „Mit Nextcloud verbinden“
3. Login im Browser bestätigen
4. Zurück zur App → automatische Anmeldung

---

## 📁 Projektstruktur

```
pollapp/
├── frontend/        # React App
├── backend/         # FastAPI Backend
├── docker-compose.yml
└── README.md
```

---

## 🧠 Besonderheiten

### Intelligente Sortierung

Die Umfragen werden automatisch priorisiert:

1. offene Umfragen mit fehlenden Antworten
2. restliche Umfragen
3. innerhalb der Gruppen nach Aktualität

---

### Benutzerzentrierte Darstellung

* Anzeige persönlicher Status
* Hervorhebung eigener Antworten
* Fokus auf „wo muss ich noch abstimmen“

---

### Register-Logik

Die Detailansicht unterstützt Gruppierungen, z. B.:

* Saxophon
* Trompete
* Rhythmusgruppe

Damit wird sofort sichtbar:

* wer fehlt
* welche Sektion vollständig ist

---

## 📌 Roadmap

Geplante Features:

* ⚙️ Einstellungen (Theme, Server, Account)
* ➕ Umfrage erstellen
* 📱 weitere Mobile-Optimierungen
* 🎨 UI/Design-Feinschliff
* 🔔 Benachrichtigungen / Erinnerungen

---

## 🤝 Beitrag

Dieses Projekt ist aktuell ein internes Tool, kann aber gerne erweitert werden.
Pull Requests und Ideen sind willkommen.

---

## 📄 Lizenz

Noch nicht festgelegt.

