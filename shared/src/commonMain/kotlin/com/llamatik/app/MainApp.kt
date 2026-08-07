package com.llamatik.app

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import cafe.adriel.voyager.navigator.Navigator
import cafe.adriel.voyager.transitions.ScaleTransition
import com.iaperso.ui.IaPersoRoot
import com.llamatik.app.localization.AvailableLanguages
import com.llamatik.app.localization.getCurrentLanguage
import com.llamatik.app.ui.screens.MainScreen

/** Primary application entry point: IA Perso local-first experience. */
@Composable
fun MainApp() {
    IaPersoRoot()
}

/**
 * Original Llamatik demo application kept available while IA Perso is being validated.
 * This makes rollback/debugging straightforward without mixing product code into the engine UI.
 */
@Composable
fun LlamatikLegacyApp() {
    val isRtl = getCurrentLanguage() == AvailableLanguages.FA

    CompositionLocalProvider(
        LocalLayoutDirection provides if (isRtl) LayoutDirection.Rtl else LayoutDirection.Ltr,
    ) {
        Navigator(MainScreen()) {
            ScaleTransition(it)
        }
    }
}
