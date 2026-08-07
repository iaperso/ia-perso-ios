# IA Perso — architecture cible

## Objectif

Construire une application iPhone offline-first capable d’exécuter localement :

- chat LLM (GGUF / llama.cpp via Llamatik),
- génération d’images (stable-diffusion.cpp via Llamatik),
- transcription vocale (whisper.cpp via Llamatik),
- historique et paramètres stockés sur l’appareil,
- téléchargement/import explicite de modèles.

Aucune API distante ne doit être nécessaire pour le fonctionnement de base.

## Principe d’architecture

Llamatik reste le **moteur d’inférence**. IA Perso devient la **couche produit**.

```text
UI Compose Multiplatform
        |
        v
IA Perso application/domain
        |
        +-- ConversationRepository
        +-- ModelRepository
        +-- LocalAIEngine (contrat stable)
                 |
                 v
        Llamatik adapter
          |      |      |
          v      v      v
      llama.cpp  SD.cpp  whisper.cpp
```

L’UI ne doit pas appeler directement `LlamaBridge`, `WhisperBridge` ou les bridges Stable Diffusion. Toute dépendance native passe par `LocalAIEngine` puis par un adaptateur Llamatik.

## Modules fonctionnels v1

### Chat

- génération en streaming,
- arrêt de génération,
- prompt système,
- historique multi-conversations,
- sélection du modèle,
- paramètres de sampling,
- conservation locale des conversations.

### Images

- text-to-image local,
- paramètres simples (taille, steps, seed),
- sauvegarde locale du résultat,
- galerie liée aux conversations.

### Voix

- transcription Whisper locale,
- insertion directe dans le composeur de message,
- transcription segmentée disponible pour une future vue conversationnelle.

### Modèles

- catalogue des modèles présents sur l’appareil,
- import depuis Files,
- téléchargement avec progression,
- validation de l’espace disque,
- suppression explicite,
- un modèle actif par capacité.

## Phases

1. **Foundation** — modèles de domaine + contrat `LocalAIEngine`.
2. **Chat local** — adaptateur Llamatik + écran chat IA Perso.
3. **Persistance** — conversations et préférences.
4. **Model manager** — import/téléchargement/suppression.
5. **Images** — stable-diffusion.cpp.
6. **Voix** — Whisper et dictée/transcription.
7. **Polish iPhone** — mémoire, thermique, erreurs, onboarding et permissions.

## Contraintes iPhone

- cible iOS minimale héritée du projet : 16.6+ ;
- ne jamais charger simultanément plusieurs gros modèles sans politique mémoire ;
- préférer quantifications adaptées aux appareils mobiles ;
- afficher clairement taille disque et statut de chargement ;
- prévoir annulation et libération immédiate des ressources natives ;
- toutes les fonctions essentielles restent utilisables hors ligne après installation des modèles.

## Règle de migration

Le code Llamatik amont doit rester aussi isolé que possible afin de pouvoir intégrer ses mises à jour. Les fonctionnalités spécifiques à IA Perso sont ajoutées sous un namespace `com.iaperso` et reliées à Llamatik par des adaptateurs dédiés.
