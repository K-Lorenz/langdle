/** Alle nutzerbezogenen Texte der Oberfläche (Deutsch). */

export const de = {
	meta: {
		siteTitle: 'Langdle',
		shortDescription:
			'Ein tägliches Wort-Rätsel: Errate die deutsche Bedeutung eines fremdländischen Worts anhand einer semantischen Wortwolke.',
		htmlLang: 'de'
	},
	header: {
		tagline: 'Tägliches Wort-Rätsel',
		subtitle:
			'Erkenne aus einem unbekannten Wort seine deutsche Bedeutung — mit einer semantischen Wortwolke.'
	},
	features: {
		title: 'So funktioniert es',
		wordcloudTitle: '1. Semantische Wortwolke',
		wordcloudBody:
			'Deine Begriffe landen in einer semantischen Karte: Nah am Zielwort erscheinen sie größer, kräftiger und wärmer gefärbt — weit weg bleiben sie klein und kühl.',
		revealTitle: '2. Nach dem Lösen',
		revealBody:
			'Du siehst die Lösung und das semantische Umfeld — ein guter Moment zum Lernen.',
		disclaimerTitle: 'Hinweis',
		disclaimerBody:
			'Alles liegt auf Deutsch; die eingebauten Daten kommen später mit dem täglichen Rätsel-Generator hinzu.'
	},
	footer: {
		note:
			'Langdle — ein kleines Projekt. Keine Registrierung; der Fortschritt bleibt lokal auf deinem Gerät.'
	},
	api: {
		keinRaetselHeute:
			'Für diesen Tag liegt noch kein Rätsel vor. Versuch es später erneut — oder wir sind noch beim Einrichten.'
	},
	game: {
		inputAria: 'Deutschen Ein-Wort‑ oder Mehrtwort‑Begriff als Tipp eingeben',
		inputPlaceholder: 'Begriff eingeben …',
		submitButton: 'Raten',
		invalidGuess: 'Dieser Begriff steht nicht in unserem deutschen Spielwörterbuch.',
		/** Wort ist im Lexikon, aber nicht Teil der heutigen Embedding-Wolke. */
		notInSemanticGrid:
			'Dieser Begriff gehört nicht zur heutigen semantischen Karte — nur Wörter aus dem Gitter sind gültige Tipps.',
		/** @deprecated — nur noch für alte Speicherstände ohne Layout; alle Lexikonwörter nutzen jetzt ConceptNet-Layout. */
		offGridGuess: 'Bekannter Tipp — Gitter-Layout fehlt (Seite neu laden).',
		offGridAria: 'Gitter-Layout für diesen Tipp nicht verfügbar',
		duplicateGuess: 'Diesen Hinweis hast du schon.',
		solvedAnnouncement: 'Gelöst! Die gesuchte deutsche Übersetzung ist „{wort}“. ',
		guessHeading: 'Deine Hinweise',
		guessListSortedByRank: 'sortiert nach Rang (kleinere Zahl = näher am Zielwort)',
		rankLabel: 'Rang {n}',
		normalHintAria: '{lemma}, Similarity {pct} Prozent, Rang {rang}',
		temperatureAria: '{temp}',
		temperatureLabel: {
			cold: 'kalt',
			warm: 'warm',
			hot: 'heiß'
		},
		bonusTitle: 'Bonusrunden',
		bonusLanguagePrompt: 'Welche Sprache ist das gesuchte Fremdwort?',
		bonusLanguageHint: 'Wähle die passende Sprache.',
		bonusCountryPrompt: 'In welchem Land ist diese Sprache Amtssprache?',
		bonusCountryHint: 'Nur für heute gültige Länder zählen.',
		bonusCorrect: 'Richtig!',
		bonusWrong: 'Leider nein — versuch es noch einmal.',
		bonusCountrySelectPlaceholder: 'Land wählen …',
		bonusCountrySubmit: 'Einreichen',
		revealSectionTitle: 'Lösung & Kontext',
		revealTargetEn: 'Deutsch: {wort}',
		revealForeignWord: 'Fremdwort: {wort}',
		languageFactSpeakers: 'ca. {n} Sprecher·innen (Schätzung)'
	},
	guessTelemetry: {
		failed: 'Tipp konnte nicht gespeichert werden (Server).'
	}
} as const;
