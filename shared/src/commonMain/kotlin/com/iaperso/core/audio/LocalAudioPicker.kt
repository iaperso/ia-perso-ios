package com.iaperso.core.audio

import io.github.vinceglb.filekit.FileKit
import io.github.vinceglb.filekit.PlatformFile
import io.github.vinceglb.filekit.copyTo
import io.github.vinceglb.filekit.delete
import io.github.vinceglb.filekit.div
import io.github.vinceglb.filekit.dialogs.FileKitType
import io.github.vinceglb.filekit.dialogs.openFilePicker
import kotlinx.datetime.Clock

/**
 * Picks a WAV file and copies it into app-private storage before native Whisper reads it.
 * Whisper's current bridge expects PCM16 mono 16 kHz WAV input.
 */
object LocalAudioPicker {
    private const val PREFIX = "ia-perso-audio-"

    suspend fun pickWhisperWav(): String? {
        val selected = FileKit.openFilePicker(
            type = FileKitType.File(listOf("wav")),
            title = "Choisir un fichier audio WAV",
        ) ?: return null

        val destination = FileKit.filesDir / "$PREFIX${Clock.System.now().toEpochMilliseconds()}.wav"
        selected.copyTo(destination)
        return destination.path
    }

    fun cleanup(path: String): Result<Unit> = runCatching {
        val filesDirPath = FileKit.filesDir.path
        require(path.startsWith(filesDirPath)) { "Refusing to delete audio outside app storage" }
        val file = PlatformFile(path)
        require(file.name.startsWith(PREFIX)) { "Refusing to delete a non-temporary audio file" }
        file.delete(mustExist = false)
    }
}
