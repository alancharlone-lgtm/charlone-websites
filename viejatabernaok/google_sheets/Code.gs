/**
 * ============================================================
 * 🛒 MI TIENDA — Google Apps Script
 * ============================================================
 * Este script se pega en el editor de Apps Script del Google Sheet
 * del comerciante. Agrega un menú personalizado con funciones
 * para facilitar la carga de productos.
 * 
 * Instalación:
 *   1. Abrir el Google Sheet
 *   2. Extensiones → Apps Script
 *   3. Pegar este código
 *   4. Guardar y recargar el Sheet
 * ============================================================
 */

// ============================================================
// MENÚ PERSONALIZADO
// ============================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🛒 Mi Tienda')
    .addItem('➕ Agregar Producto', 'showAddProductForm')
    .addItem('📸 Subir Foto / Video', 'showMediaUploader')
    .addSeparator()
    .addItem('🔄 Formatear Planilla', 'formatSheet')
    .addItem('📊 Resumen de Stock', 'showSummary')
    .addToUi();
}

// ============================================================
// CONFIGURACIÓN INICIAL DE LA PLANILLA
// ============================================================
function setupSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  sheet.setName('Productos');
  
  // Headers
  var headers = ['ID', 'Nombre', 'Descripción', 'Categoría', 'Precio', 'Talles', 'Foto URL', 'Video URL', 'Activo'];
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  
  // Estilo de headers
  headerRange.setFontWeight('bold')
    .setBackground('#111111')
    .setFontColor('#FFFFFF')
    .setFontSize(11)
    .setHorizontalAlignment('center');
  
  // Anchos de columna
  sheet.setColumnWidth(1, 50);   // ID
  sheet.setColumnWidth(2, 200);  // Nombre
  sheet.setColumnWidth(3, 300);  // Descripción
  sheet.setColumnWidth(4, 130);  // Categoría
  sheet.setColumnWidth(5, 100);  // Precio
  sheet.setColumnWidth(6, 150);  // Talles
  sheet.setColumnWidth(7, 300);  // Foto URL
  sheet.setColumnWidth(8, 300);  // Video URL
  sheet.setColumnWidth(9, 80);   // Activo
  
  // Proteger headers
  var protection = headerRange.protect().setDescription('Headers - No tocar');
  protection.setWarningOnly(true);
  
  // Validación: Categoría (dropdown)
  var catRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Minutas', 'Pizzas', 'Empanadas', 'Parrilla', 'Especiales', 'Bebidas', 'Postres'], true)
    .setAllowInvalid(false)
    .setHelpText('Elegí una categoría de la lista')
    .build();
  sheet.getRange('D2:D100').setDataValidation(catRule);
  
  // Validación: Precio (solo números)
  var priceRule = SpreadsheetApp.newDataValidation()
    .requireNumberGreaterThan(0)
    .setAllowInvalid(false)
    .setHelpText('Ingresá un precio válido (solo números)')
    .build();
  sheet.getRange('E2:E100').setDataValidation(priceRule);
  
  // Validación: Activo (checkbox) — ahora columna I
  sheet.getRange('I2:I100').insertCheckboxes();
  sheet.getRange('I2:I100').setValue(true);
  
  // Formato moneda en Precio
  sheet.getRange('E2:E100').setNumberFormat('$#,##0');
  
  // Congelar fila 1
  sheet.setFrozenRows(1);
  
  // Formato condicional: fila roja si falta foto
  var rule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($G2="",$B2<>"")')
    .setBackground('#FFF0F0')
    .setRanges([sheet.getRange('A2:I100')])
    .build();
  sheet.setConditionalFormatRules([rule]);
  
  SpreadsheetApp.getUi().alert('✅ Planilla configurada correctamente.\n\nYa podés empezar a cargar productos desde el menú 🛒 Mi Tienda.');
}

// ============================================================
// FORMULARIO: AGREGAR PRODUCTO
// ============================================================
function showAddProductForm() {
  var html = HtmlService.createHtmlOutputFromFile('ProductForm')
    .setWidth(450)
    .setHeight(550)
    .setTitle('Agregar Producto');
  SpreadsheetApp.getUi().showSidebar(html);
}

function addProduct(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Productos');
  if (!sheet) sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  
  var lastRow = sheet.getLastRow();
  var newId = lastRow; // Simple auto-increment
  
  sheet.appendRow([
    newId,
    data.name,
    data.description,
    data.category,
    parseFloat(data.price),
    data.sizes,
    data.imageUrl || '',
    data.videoUrl || '',
    true
  ]);
  
  return { success: true, id: newId, row: lastRow + 1 };
}

// ============================================================
// SUBIR FOTO O VIDEO A GOOGLE DRIVE
// ============================================================
function showMediaUploader() {
  var html = HtmlService.createHtmlOutputFromFile('ImageUploader')
    .setWidth(450)
    .setHeight(550)
    .setTitle('Subir Foto o Video');
  SpreadsheetApp.getUi().showSidebar(html);
}

function uploadFileToDrive(base64Data, fileName, mimeType, fileType) {
  // Carpeta según tipo
  var folderName = (fileType === 'video') ? 'Videos Tienda' : 'Fotos Tienda';
  var folders = DriveApp.getFoldersByName(folderName);
  var folder;
  
  if (folders.hasNext()) {
    folder = folders.next();
  } else {
    folder = DriveApp.createFolder(folderName);
    folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  }
  
  // Decodificar y guardar
  var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  
  var fileId = file.getId();
  var directUrl;
  
  if (fileType === 'video') {
    // Para videos, usar URL de descarga directa de Drive
    directUrl = 'https://drive.google.com/file/d/' + fileId + '/preview';
  } else {
    // Para fotos, usar URL directa de imagen
    directUrl = 'https://lh3.googleusercontent.com/d/' + fileId;
  }
  
  return { success: true, url: directUrl, fileId: fileId };
}

// Mantener compatibilidad con versión anterior
function uploadImageToDrive(base64Data, fileName, mimeType) {
  return uploadFileToDrive(base64Data, fileName, mimeType, 'image');
}

function setImageUrlInRow(row, url) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Productos');
  if (!sheet) sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  sheet.getRange(row, 7).setValue(url); // Columna G = Foto URL
}

function appendImageUrlInRow(row, url) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Productos');
  if (!sheet) sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var cell = sheet.getRange(row, 7); // Columna G = Foto URL
  var existing = cell.getValue();
  if (existing && existing.toString().trim() !== '') {
    cell.setValue(existing + ', ' + url); // Agregar con coma
  } else {
    cell.setValue(url);
  }
}

function appendMultipleImageUrls(row, urls) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Productos');
  if (!sheet) sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var cell = sheet.getRange(row, 7); // Columna G = Foto URL
  var existing = cell.getValue();
  var newUrls = urls.join(', ');
  if (existing && existing.toString().trim() !== '') {
    cell.setValue(existing + ', ' + newUrls);
  } else {
    cell.setValue(newUrls);
  }
}

function setVideoUrlInRow(row, url) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Productos');
  if (!sheet) sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  sheet.getRange(row, 8).setValue(url); // Columna H = Video URL
}

function getProductRows() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Productos');
  if (!sheet) sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = sheet.getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][1]) { // Si tiene nombre
      rows.push({ row: i + 1, name: data[i][1] });
    }
  }
  return rows;
}

// ============================================================
// FORMATEAR PLANILLA
// ============================================================
function formatSheet() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  
  var dataRange = sheet.getRange(2, 1, lastRow - 1, 9);
  
  // Alternar colores de fila
  for (var i = 2; i <= lastRow; i++) {
    var bg = (i % 2 === 0) ? '#FAFAFA' : '#FFFFFF';
    sheet.getRange(i, 1, 1, 9).setBackground(bg);
  }
  
  // Centrar ID y Activo
  sheet.getRange(2, 1, lastRow - 1, 1).setHorizontalAlignment('center');
  sheet.getRange(2, 9, lastRow - 1, 1).setHorizontalAlignment('center');
  
  SpreadsheetApp.getUi().alert('✅ Planilla formateada.');
}

// ============================================================
// RESUMEN
// ============================================================
function showSummary() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = sheet.getDataRange().getValues();
  
  var total = 0;
  var active = 0;
  var noPhoto = 0;
  var categories = {};
  
  for (var i = 1; i < data.length; i++) {
    if (!data[i][1]) continue; // Skip empty rows
    total++;
    if (data[i][8] === true) active++;
    if (!data[i][6]) noPhoto++;
    var noVideo = !data[i][7] ? 1 : 0;
    var cat = data[i][3] || 'Sin categoría';
    categories[cat] = (categories[cat] || 0) + 1;
  }
  
  var msg = '📊 RESUMEN DE TU TIENDA\n\n';
  msg += '🛍️ Total productos: ' + total + '\n';
  msg += '✅ Activos: ' + active + '\n';
  msg += '⛔ Inactivos: ' + (total - active) + '\n';
  msg += '📷 Sin foto: ' + noPhoto + '\n\n';
  msg += '📂 Por categoría:\n';
  for (var cat in categories) {
    msg += '   • ' + cat + ': ' + categories[cat] + '\n';
  }
  
  SpreadsheetApp.getUi().alert(msg);
}
