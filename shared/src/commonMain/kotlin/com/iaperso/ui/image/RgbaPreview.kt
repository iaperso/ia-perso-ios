package com.iaperso.ui.image

import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Canvas
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Paint
import kotlin.math.ceil
import kotlin.math.max

/**
 * Builds a lightweight Compose preview from the raw RGBA bytes returned by
 * stable-diffusion.cpp. The preview is downsampled to avoid drawing hundreds of
 * thousands of individual pixels into a UI bitmap.
 */
fun rgbaToPreviewImageBitmap(
    rgba: ByteArray,
    width: Int,
    height: Int,
    maxSide: Int = 256,
): ImageBitmap {
    require(width > 0 && height > 0)
    require(rgba.size >= width * height * 4)

    val sampleStep = max(1, ceil(max(width, height).toDouble() / maxSide).toInt())
    val previewWidth = (width + sampleStep - 1) / sampleStep
    val previewHeight = (height + sampleStep - 1) / sampleStep
    val bitmap = ImageBitmap(previewWidth, previewHeight)
    val canvas = Canvas(bitmap)
    val paint = Paint()

    for (py in 0 until previewHeight) {
        val sourceY = (py * sampleStep).coerceAtMost(height - 1)
        for (px in 0 until previewWidth) {
            val sourceX = (px * sampleStep).coerceAtMost(width - 1)
            val offset = (sourceY * width + sourceX) * 4
            val red = rgba[offset].toInt() and 0xFF
            val green = rgba[offset + 1].toInt() and 0xFF
            val blue = rgba[offset + 2].toInt() and 0xFF
            val alpha = rgba[offset + 3].toInt() and 0xFF
            paint.color = Color(red, green, blue, alpha)
            canvas.drawRect(
                Rect(px.toFloat(), py.toFloat(), px + 1f, py + 1f),
                paint,
            )
        }
    }

    bitmap.prepareToDraw()
    return bitmap
}
