package com.llamatik.app

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import com.llamatik.library.platform.StableDiffusionBridge
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.jetbrains.compose.resources.decodeToImageBitmap

private const val IMAGE_SIZE = 512
private const val DEFAULT_MODEL = "dreamshaper.safetensors"

/** IA Perso : un prompt -> une image. Aucun chat, aucun menu. */
@Composable
fun MainApp() {
    MaterialTheme {
        var prompt by remember { mutableStateOf("") }
        var image by remember { mutableStateOf<ImageBitmap?>(null) }
        var isGenerating by remember { mutableStateOf(false) }
        var error by remember { mutableStateOf<String?>(null) }
        var modelReady by remember { mutableStateOf(false) }
        val scope = rememberCoroutineScope()

        Surface(modifier = Modifier.fillMaxSize()) {
            Column(
                modifier = Modifier.fillMaxSize().padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                OutlinedTextField(
                    value = prompt,
                    onValueChange = { prompt = it },
                    modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text("Décris l’image…") },
                    minLines = 3,
                    maxLines = 6,
                    enabled = !isGenerating,
                )

                Button(
                    modifier = Modifier.fillMaxWidth(),
                    enabled = prompt.isNotBlank() && !isGenerating,
                    onClick = {
                        scope.launch {
                            isGenerating = true
                            error = null
                            try {
                                val bmp = withContext(Dispatchers.Default) {
                                    if (!modelReady) {
                                        val modelPath = StableDiffusionBridge.getModelPath(DEFAULT_MODEL)
                                        modelReady = StableDiffusionBridge.initModel(modelPath, threads = 4)
                                        check(modelReady) {
                                            "Modèle introuvable : $DEFAULT_MODEL"
                                        }
                                    }

                                    val rgba = StableDiffusionBridge.txt2img(
                                        prompt = prompt.trim(),
                                        width = IMAGE_SIZE,
                                        height = IMAGE_SIZE,
                                        steps = 20,
                                        cfgScale = 7.0f,
                                        seed = -1L,
                                    )
                                    check(rgba.size == IMAGE_SIZE * IMAGE_SIZE * 4) {
                                        "La génération n’a renvoyé aucune image."
                                    }
                                    rgbaToBmp(rgba, IMAGE_SIZE, IMAGE_SIZE).decodeToImageBitmap()
                                }
                                image = bmp
                            } catch (t: Throwable) {
                                error = t.message ?: "Erreur de génération"
                            } finally {
                                isGenerating = false
                            }
                        }
                    },
                ) {
                    Text(if (isGenerating) "Génération…" else "Générer")
                }

                Box(
                    modifier = Modifier.fillMaxWidth().weight(1f),
                    contentAlignment = Alignment.Center,
                ) {
                    when {
                        isGenerating -> CircularProgressIndicator()
                        image != null -> Image(
                            bitmap = image!!,
                            contentDescription = prompt,
                            modifier = Modifier.fillMaxSize(),
                            contentScale = ContentScale.Fit,
                        )
                        error != null -> Text(error!!, color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }
    }
}

/**
 * stable-diffusion.cpp renvoie du RGBA brut. Compose sait décoder BMP sur les
 * cibles mobiles/desktop ; on encapsule donc les pixels dans un BMP 32 bits,
 * sans dépendance de codec ni serveur intermédiaire.
 */
private fun rgbaToBmp(rgba: ByteArray, width: Int, height: Int): ByteArray {
    require(rgba.size == width * height * 4)
    val pixelBytes = width * height * 4
    val headerSize = 54
    val out = ByteArray(headerSize + pixelBytes)

    fun put16(offset: Int, value: Int) {
        out[offset] = (value and 0xff).toByte()
        out[offset + 1] = ((value ushr 8) and 0xff).toByte()
    }
    fun put32(offset: Int, value: Int) {
        out[offset] = (value and 0xff).toByte()
        out[offset + 1] = ((value ushr 8) and 0xff).toByte()
        out[offset + 2] = ((value ushr 16) and 0xff).toByte()
        out[offset + 3] = ((value ushr 24) and 0xff).toByte()
    }

    out[0] = 'B'.code.toByte()
    out[1] = 'M'.code.toByte()
    put32(2, out.size)
    put32(10, headerSize)
    put32(14, 40)
    put32(18, width)
    put32(22, height)
    put16(26, 1)
    put16(28, 32)
    put32(34, pixelBytes)

    var dst = headerSize
    for (y in height - 1 downTo 0) {
        var src = y * width * 4
        repeat(width) {
            val r = rgba[src]
            val g = rgba[src + 1]
            val b = rgba[src + 2]
            val a = rgba[src + 3]
            out[dst] = b
            out[dst + 1] = g
            out[dst + 2] = r
            out[dst + 3] = a
            src += 4
            dst += 4
        }
    }
    return out
}
