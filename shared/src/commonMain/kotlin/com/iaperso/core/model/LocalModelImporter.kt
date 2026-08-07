package com.iaperso.core.model

import io.github.vinceglb.filekit.FileKit
import io.github.vinceglb.filekit.copyTo
import io.github.vinceglb.filekit.createDirectories
import io.github.vinceglb.filekit.div
import io.github.vinceglb.filekit.dialogs.FileKitType
import io.github.vinceglb.filekit.dialogs.openFilePicker
import io.github.vinceglb.filekit.size
import kotlinx.datetime.Clock

/** Imports a user-selected model into IA Perso's private application storage. */
object LocalModelImporter {
    suspend fun import(capability: ModelCapability): LocalModel? {
        val extensions = when (capability) {
            ModelCapability.TEXT_GENERATION -> listOf("gguf")
            ModelCapability.IMAGE_GENERATION -> listOf("safetensors", "ckpt", "gguf")
            ModelCapability.SPEECH_TO_TEXT -> listOf("bin")
        }

        val selected = FileKit.openFilePicker(
            type = FileKitType.File(extensions),
            title = when (capability) {
                ModelCapability.TEXT_GENERATION -> "Choisir un modèle texte GGUF"
                ModelCapability.IMAGE_GENERATION -> "Choisir un modèle de génération d’images"
                ModelCapability.SPEECH_TO_TEXT -> "Choisir un modèle Whisper"
            },
        ) ?: return null

        val modelsDir = FileKit.filesDir / "ia-perso-models"
        modelsDir.createDirectories()

        val stamp = Clock.System.now().toEpochMilliseconds()
        val destination = modelsDir / "${stamp}-${selected.name}"
        selected.copyTo(destination)

        return LocalModel(
            id = "${capability.name.lowercase()}-$stamp",
            displayName = selected.nameWithoutExtension,
            fileName = destination.name,
            capability = capability,
            localPath = destination.path,
            sizeBytes = runCatching { destination.size() }.getOrNull(),
            state = ModelState.INSTALLED,
        )
    }
}
