import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);

/**
 * Convierte un archivo WebM a MP3 usando ffmpeg
 * 
 * @param {string} inputPath - Ruta del archivo WebM de entrada
 * @param {string} outputPath - Ruta del archivo MP3 de salida
 * @returns {Promise<void>}
 */
export async function convertWebMToMP3(inputPath, outputPath) {
  try {
    // Comando ffmpeg para conversión
    // -i: archivo de entrada
    // -vn: sin video (solo audio)
    // -ar 16000: sample rate 16kHz (óptimo para Whisper)
    // -ac 1: 1 canal (mono)
    // -b:a 64k: bitrate 64kbps (suficiente para voz)
    // -y: sobrescribir si existe
    const command = `ffmpeg -i "${inputPath}" -vn -ar 16000 -ac 1 -b:a 64k -y "${outputPath}"`;
    
    await execAsync(command);
    
    return true;
  } catch (error) {
    throw new Error(`Error convirtiendo WebM a MP3: ${error.message}`);
  }
}

/**
 * Convierte un Buffer de audio WebM a MP3
 * 
 * @param {Buffer} webmBuffer - Buffer con datos WebM
 * @param {string} sessionId - ID de sesión para nombres únicos
 * @returns {Promise<{mp3Path: string, cleanup: Function}>}
 */
export async function convertWebMBufferToMP3(webmBuffer, sessionId) {
  const tempDir = os.tmpdir();
  const timestamp = Date.now();
  
  // Crear archivos temporales
  const webmPath = path.join(tempDir, `input-${sessionId}-${timestamp}.webm`);
  const mp3Path = path.join(tempDir, `output-${sessionId}-${timestamp}.mp3`);
  
  try {
    // Escribir buffer WebM a archivo temporal
    await fs.promises.writeFile(webmPath, webmBuffer);
    
    // Convertir a MP3
    await convertWebMToMP3(webmPath, mp3Path);
    
    // Verificar que el MP3 se creó
    const stats = await fs.promises.stat(mp3Path);
    if (stats.size === 0) {
      throw new Error('El archivo MP3 generado está vacío');
    }
    
    // Función de limpieza
    const cleanup = async () => {
      try {
        await fs.promises.unlink(webmPath);
        await fs.promises.unlink(mp3Path);
      } catch (err) {
        // Ignorar errores de limpieza
      }
    };
    
    return { mp3Path, cleanup };
    
  } catch (error) {
    // Limpiar archivos en caso de error
    try {
      await fs.promises.unlink(webmPath);
      await fs.promises.unlink(mp3Path);
    } catch (err) {
      // Ignorar errores de limpieza
    }
    
    throw error;
  }
}

/**
 * Verifica si ffmpeg está disponible en el sistema
 * 
 * @returns {Promise<boolean>}
 */
export async function checkFFmpegAvailable() {
  try {
    await execAsync('ffmpeg -version');
    return true;
  } catch (error) {
    return false;
  }
}

export default {
  convertWebMToMP3,
  convertWebMBufferToMP3,
  checkFFmpegAvailable,
};