package com.iaperso.ui

import androidx.compose.runtime.Composable
import com.iaperso.core.model.LocalModelImporter

@Composable
fun IaPersoRoot() {
    IaPersoRoot(importLocalModel = LocalModelImporter::import)
}
