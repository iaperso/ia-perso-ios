package com.iaperso.core.model

/**
 * Conservative starter catalogue for IA Perso.
 *
 * No model is bundled automatically: users explicitly import/download files.
 * Keeping the catalogue metadata-only avoids licensing surprises and keeps the app small.
 */
object DefaultModelCatalog {
    val entries: List<LocalModel> = listOf(
        LocalModel(
            id = "text-gguf-custom",
            displayName = "Modèle texte GGUF",
            fileName = "model.gguf",
            capability = ModelCapability.TEXT_GENERATION,
        ),
        LocalModel(
            id = "image-sd-custom",
            displayName = "Modèle image local",
            fileName = "model.safetensors",
            capability = ModelCapability.IMAGE_GENERATION,
        ),
        LocalModel(
            id = "speech-whisper-custom",
            displayName = "Modèle Whisper local",
            fileName = "whisper.bin",
            capability = ModelCapability.SPEECH_TO_TEXT,
        ),
    )
}
