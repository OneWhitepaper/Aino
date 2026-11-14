import { accountLogin } from './account-page'
import type { TranslationOverrides } from './define-locale'
import { en } from './en'

export const runtimeFeatureCopy = {
  de: {
    composer: {
      taskPaused: 'Aufgabe pausiert. Mit dem gespeicherten Fortschritt fortfahren.',
      taskPausing: 'Wird pausiert…'
    },
    platformUsage: {
      purposes: {
        image: 'Bilderzeugung'
      }
    },
    settings: {
      account: {
        ...accountLogin.de,
        phoneAutoRegister: 'Neue Nummern werden nach der Bestätigung automatisch registriert.',
        browserSessionOnly: 'Dieser Browser hält dich nur bis zum Schließen oder Neuladen dieses Tabs angemeldet.',
        platformError: (code, retryAfter) =>
          code === 'captcha_browser_unavailable'
            ? 'Diese Website erfordert eine Verifizierung in der Aino-Desktop-App. Öffne die Desktop-App, um dich anzumelden.'
            : en.settings.account.platformError(code, retryAfter)
      },
      model: {
        imageGeneration: {
          qualityTitle: 'Bildqualität',
          qualityHint:
            'Steuert Detailgrad und Rechenaufwand. Höhere Qualität kann mehr Zeit und Guthaben benötigen. Unabhängig von der Text-Denktiefe.',
          qualityDefault: 'Modellstandard',
          qualityUnsupported:
            'Die gespeicherte Qualität wird nicht mehr unterstützt. Wähle eine andere Stufe oder den Modellstandard.',
          qualitySavedHint: 'Gilt für folgende Bildanfragen.',
          qualitySaved: 'Bildqualität gespeichert',
          qualityRuntimeUnavailable:
            'Aktualisiere die Laufzeit, um die Bildqualität zu wählen. Die aktuelle Qualität bleibt bestehen.',
          qualityUnavailable: 'Dieses Modell bietet keine Qualitätsstufen. Es verwendet seinen Standard.',
          runtimeUnavailable:
            'Die Laufzeit unterstützt die Aino-Bilderzeugung nicht. Starte sie neu oder aktualisiere sie.',
          loadFailed: 'Bildeinstellungen konnten nicht geladen werden. Prüfe die Verbindung und versuche es erneut.',
          billingRules: 'Abrechnung nach den Regeln für Bilderzeugung. Verbrauch unter Mein Konto ansehen.',
          unavailable:
            'Aino-Bilderzeugung nicht verfügbar. Aktualisiere die Laufzeit und prüfe die Plattformkonfiguration.',
          title: 'Bilderzeugung',
          description:
            'Erzeuge Bilder mit deinem Aino-Konto. Bildmodelle werden getrennt von Textmodellen verwaltet; die Auswahl gilt für neue Chats.',
          qualityLabels: {
            auto: 'Automatisch',
            low: 'Niedrig',
            medium: 'Mittel',
            high: 'Hoch',
            xhigh: 'Sehr hoch',
            max: 'Maximum'
          }
        }
      }
    },
    shell: {
      statusbar: {
        contextUsagePanel: {
          compactTitle: 'Kontextfenster'
        }
      }
    }
  },
  es: {
    composer: {
      taskPaused: 'Tarea en pausa. Continúa desde el progreso guardado.',
      taskPausing: 'Pausando…'
    },
    platformUsage: {
      purposes: {
        image: 'Generación de imágenes'
      }
    },
    settings: {
      account: {
        ...accountLogin.es,
        phoneAutoRegister: 'Los números nuevos se registran al verificarlos.',
        browserSessionOnly: 'La sesión de este navegador dura hasta que cierres o recargues esta pestaña.',
        platformError: (code, retryAfter) =>
          code === 'captcha_browser_unavailable'
            ? 'Este sitio requiere verificación en la aplicación de escritorio de Aino. Ábrela para iniciar sesión.'
            : en.settings.account.platformError(code, retryAfter)
      },
      model: {
        imageGeneration: {
          qualityTitle: 'Calidad de imagen',
          qualityHint:
            'Controla el detalle y el esfuerzo de generación. Una mayor calidad puede tardar y costar más. Es independiente del razonamiento de texto.',
          qualityDefault: 'Predeterminada del modelo',
          qualityUnsupported: 'La calidad guardada ya no es compatible. Elige otro nivel o restaura la predeterminada.',
          qualitySavedHint: 'Se aplica a las siguientes solicitudes de imágenes.',
          qualitySaved: 'Calidad de imagen guardada',
          qualityRuntimeUnavailable:
            'Actualiza el entorno de ejecución para elegir la calidad. La calidad actual no cambia.',
          qualityUnavailable: 'Este modelo no permite ajustar la calidad. Se usa su valor predeterminado.',
          runtimeUnavailable: 'El entorno actual no ofrece generación de imágenes de Aino. Reinícialo o actualízalo.',
          loadFailed: 'No se pudieron cargar los ajustes de imagen. Comprueba la conexión e inténtalo de nuevo.',
          billingRules: 'Se factura según las reglas de generación de imágenes. Consulta el uso en Mi cuenta.',
          unavailable:
            'La generación de imágenes de Aino no está disponible. Actualiza el entorno y comprueba los modelos configurados.',
          title: 'Generación de imágenes',
          description:
            'Genera imágenes con tu cuenta de Aino. Los modelos de imagen se gestionan por separado de los de texto; la selección se aplica a nuevas conversaciones.',
          qualityLabels: {
            auto: 'Automática',
            low: 'Baja',
            medium: 'Media',
            high: 'Alta',
            xhigh: 'Muy alta',
            max: 'Máxima'
          }
        }
      }
    },
    shell: {
      statusbar: {
        contextUsagePanel: {
          compactTitle: 'Ventana de contexto'
        }
      }
    }
  },
  fr: {
    composer: {
      taskPaused: 'Tâche en pause. Reprenez à partir de la progression conservée.',
      taskPausing: 'Mise en pause…'
    },
    platformUsage: {
      purposes: {
        image: 'Génération d’images'
      }
    },
    settings: {
      account: {
        ...accountLogin.fr,
        phoneAutoRegister: 'Les nouveaux numéros sont inscrits après vérification.',
        browserSessionOnly:
          'La connexion est conservée uniquement jusqu’à la fermeture ou au rechargement de cet onglet.',
        platformError: (code, retryAfter) =>
          code === 'captcha_browser_unavailable'
            ? 'Ce site exige une vérification dans l’application de bureau Aino. Ouvrez-la pour vous connecter.'
            : en.settings.account.platformError(code, retryAfter)
      },
      model: {
        imageGeneration: {
          qualityTitle: 'Qualité des images',
          qualityHint:
            'Contrôle les détails et l’effort de génération. Une qualité supérieure peut demander plus de temps et coûter plus cher. Indépendant du raisonnement textuel.',
          qualityDefault: 'Valeur du modèle',
          qualityUnsupported:
            'La qualité enregistrée n’est plus prise en charge. Choisissez un autre niveau ou la valeur du modèle.',
          qualitySavedHint: 'S’applique aux prochaines demandes d’images.',
          qualitySaved: 'Qualité des images enregistrée',
          qualityRuntimeUnavailable:
            'Mettez à jour le moteur pour choisir la qualité. La qualité actuelle est conservée.',
          qualityUnavailable: 'Ce modèle ne propose aucun niveau de qualité. Sa valeur par défaut est utilisée.',
          runtimeUnavailable:
            'Le moteur actuel ne propose pas la génération d’images Aino. Redémarrez-le ou mettez-le à jour.',
          loadFailed: 'Impossible de charger les réglages d’images. Vérifiez la connexion et réessayez.',
          billingRules: 'Facturation selon les règles de génération d’images. Consultez l’utilisation dans Mon compte.',
          unavailable:
            'La génération d’images Aino est indisponible. Mettez à jour le moteur et vérifiez les modèles configurés.',
          title: 'Génération d’images',
          description:
            'Générez des images avec votre compte Aino. Les modèles d’images sont gérés séparément des modèles de texte ; vos choix s’appliquent aux nouvelles conversations.',
          qualityLabels: {
            auto: 'Automatique',
            low: 'Faible',
            medium: 'Moyenne',
            high: 'Élevée',
            xhigh: 'Très élevée',
            max: 'Maximale'
          }
        }
      }
    },
    shell: {
      statusbar: {
        contextUsagePanel: {
          compactTitle: 'Fenêtre de contexte'
        }
      }
    }
  },
  ja: {
    assistant: { thread: { responseStopped: '一時停止しました。ここまでの進行状況は保持されています。' } },
    composer: {
      taskPaused: 'タスクを一時停止しました。保存された進行状況から続行できます。',
      taskPausing: '一時停止中…'
    },
    platformUsage: {
      purposes: {
        image: '画像生成'
      }
    },
    settings: {
      account: {
        ...accountLogin.ja,
        browserSessionOnly: 'このブラウザーのログインは、このタブを閉じるか再読み込みするまで有効です。'
      },
      model: {
        imageGeneration: {
          qualityTitle: '画像品質',
          qualityHint:
            '細部の描写と生成処理量を調整します。品質を上げると時間と料金が増える場合があります。テキストの推論強度とは独立しています。',
          qualityDefault: 'モデルの既定値',
          qualityUnsupported:
            '保存された品質はサポートされなくなりました。別の段階を選ぶか、モデルの既定値に戻してください。',
          qualitySavedHint: '次の画像生成リクエストから適用されます。',
          qualitySaved: '画像品質を保存しました',
          qualityRuntimeUnavailable: '画像品質を選ぶにはランタイムを更新してください。現在の品質は維持されます。',
          qualityUnavailable: 'このモデルには品質設定がありません。既定の品質を使用します。',
          runtimeUnavailable: '現在のランタイムはAinoの画像生成に対応していません。再起動または更新してください。',
          loadFailed: '画像設定を読み込めませんでした。接続を確認して再試行してください。',
          billingRules: '画像生成の料金規則で課金されます。「マイアカウント」で使用量を確認できます。',
          unavailable:
            'Ainoの画像生成を利用できません。ランタイムを更新し、プラットフォームの画像モデル設定を確認してください。',
          title: '画像生成',
          description:
            'Ainoアカウントで画像を生成します。画像モデルとテキストモデルは別々に管理され、選択は新しい会話に適用されます。',
          qualityLabels: {
            auto: '自動',
            low: '低',
            medium: '中',
            high: '高',
            xhigh: '非常に高い',
            max: '最大'
          }
        }
      }
    },
    shell: {
      statusbar: {
        contextUsagePanel: {
          compactTitle: 'コンテキストウィンドウ'
        }
      }
    }
  },
  ru: {
    assistant: { thread: { responseStopped: 'Приостановлено. Текущий прогресс сохранён.' } },
    composer: {
      taskPaused: 'Задача приостановлена. Можно продолжить с сохранённого места.',
      taskPausing: 'Приостановка…'
    },
    platformUsage: {
      purposes: {
        image: 'Генерация изображений'
      }
    },
    settings: {
      account: {
        ...accountLogin.ru,
        phoneAutoRegister: 'Новые номера регистрируются после проверки.',
        browserSessionOnly: 'Вход в этом браузере сохраняется только до закрытия или перезагрузки этой вкладки.',
        platformError: (code, retryAfter) =>
          code === 'captcha_browser_unavailable'
            ? 'Для проверки на этом сайте требуется настольное приложение Aino. Откройте его, чтобы войти.'
            : en.settings.account.platformError(code, retryAfter)
      },
      model: {
        imageGeneration: {
          qualityTitle: 'Качество изображений',
          qualityHint:
            'Управляет детализацией и затратами на генерацию. Более высокое качество может требовать больше времени и средств. Не связано с глубиной рассуждений для текста.',
          qualityDefault: 'По умолчанию модели',
          qualityUnsupported:
            'Сохранённое качество больше не поддерживается. Выберите другой уровень или значение по умолчанию.',
          qualitySavedHint: 'Применяется к следующим запросам изображений.',
          qualitySaved: 'Качество изображений сохранено',
          qualityRuntimeUnavailable:
            'Обновите среду выполнения, чтобы выбирать качество. Текущее качество не изменится.',
          qualityUnavailable: 'У этой модели нет настроек качества. Используется значение по умолчанию.',
          runtimeUnavailable:
            'Текущая среда не поддерживает генерацию изображений Aino. Перезапустите или обновите её.',
          loadFailed: 'Не удалось загрузить настройки изображений. Проверьте соединение и повторите попытку.',
          billingRules: 'Оплата по правилам генерации изображений. Расход можно посмотреть в разделе «Мой аккаунт».',
          unavailable:
            'Генерация изображений Aino недоступна. Обновите среду и проверьте настройки моделей на платформе.',
          title: 'Генерация изображений',
          description:
            'Создавайте изображения с аккаунтом Aino. Модели изображений управляются отдельно от текстовых; выбор применяется к новым чатам.',
          qualityLabels: {
            auto: 'Авто',
            low: 'Низкое',
            medium: 'Среднее',
            high: 'Высокое',
            xhigh: 'Очень высокое',
            max: 'Максимум'
          }
        }
      }
    },
    shell: {
      statusbar: {
        contextUsagePanel: {
          compactTitle: 'Окно контекста'
        }
      }
    }
  },
  ar: {
    assistant: { thread: { responseStopped: 'متوقف مؤقتًا. تم الاحتفاظ بالتقدم الحالي.' } },
    composer: {
      taskPaused: 'المهمة متوقفة مؤقتًا. تابع من التقدم المحفوظ.',
      taskPausing: 'جارٍ الإيقاف المؤقت…'
    },
    platformUsage: {
      purposes: {
        image: 'توليد الصور'
      }
    },
    settings: {
      account: {
        ...accountLogin.ar,
        phoneAutoRegister: 'تُسجَّل الأرقام الجديدة تلقائيًا بعد التحقق.',
        browserSessionOnly: 'يبقى تسجيل الدخول في هذا المتصفح حتى إغلاق علامة التبويب هذه أو إعادة تحميلها فقط.',
        platformError: (code, retryAfter) =>
          code === 'captcha_browser_unavailable'
            ? 'يتطلب هذا الموقع التحقق في تطبيق Aino لسطح المكتب. افتح التطبيق لتسجيل الدخول.'
            : en.settings.account.platformError(code, retryAfter)
      },
      model: {
        imageGeneration: {
          qualityTitle: 'جودة الصورة',
          qualityHint:
            'تتحكم في التفاصيل وجهد التوليد. قد تستغرق الجودة الأعلى وقتًا وتكلفة أكبر. وهي مستقلة عن عمق التفكير النصي.',
          qualityDefault: 'الإعداد الافتراضي للنموذج',
          qualityUnsupported: 'لم تعد الجودة المحفوظة مدعومة. اختر مستوى آخر أو استعد الإعداد الافتراضي.',
          qualitySavedHint: 'تُطبق على طلبات الصور التالية.',
          qualitySaved: 'تم حفظ جودة الصورة',
          qualityRuntimeUnavailable: 'حدّث بيئة التشغيل لاختيار الجودة. لن تتغير الجودة الحالية.',
          qualityUnavailable: 'لا يوفر هذا النموذج مستويات جودة قابلة للتعديل. تُستخدم الجودة الافتراضية.',
          runtimeUnavailable: 'لا تدعم بيئة التشغيل الحالية توليد صور Aino. أعد تشغيلها أو حدّثها.',
          loadFailed: 'تعذر تحميل إعدادات الصور. تحقق من الاتصال وحاول مجددًا.',
          billingRules: 'تُحسب التكلفة وفق قواعد توليد الصور. راجع الاستخدام في حسابي.',
          unavailable: 'توليد صور Aino غير متاح. حدّث بيئة التشغيل وتحقق من إعداد نماذج الصور على المنصة.',
          title: 'توليد الصور',
          description:
            'أنشئ صورًا باستخدام حساب Aino. تُدار نماذج الصور بشكل منفصل عن نماذج النص، وتُطبق الاختيارات على المحادثات الجديدة.',
          qualityLabels: {
            auto: 'تلقائية',
            low: 'منخفضة',
            medium: 'متوسطة',
            high: 'عالية',
            xhigh: 'عالية جدًا',
            max: 'القصوى'
          }
        }
      }
    },
    shell: {
      statusbar: {
        contextUsagePanel: {
          compactTitle: 'نافذة السياق',
          detailsUnavailable: 'تفاصيل الفئات غير متاحة مؤقتًا. لا يزال الاستخدام الحالي ظاهرًا.',
          pendingDetails: 'لم توفر بيئة التشغيل الحالية تفاصيل الفئات.',
          retry: 'إعادة المحاولة',
          unavailable: 'استخدام السياق غير متاح مؤقتًا. حاول مجددًا.'
        }
      }
    }
  },
  'zh-hant': {
    assistant: { thread: { responseStopped: '已暫停，目前進度已保留。' } },
    composer: {
      taskPaused: '任務已暫停，可從保留的進度繼續。',
      taskPausing: '正在暫停…'
    },
    platformUsage: {
      purposes: {
        image: '圖片生成'
      }
    },
    settings: {
      account: {
        ...accountLogin['zh-hant'],
        browserSessionOnly: '此瀏覽器僅在目前分頁內保持登入，關閉或重新整理後需要重新登入。'
      },
      model: {
        imageGeneration: {
          qualityTitle: '出圖品質',
          qualityHint: '控制圖片細節與生成精細度。品質越高，可能耗時更長、費用更高，與文字推理強度互相獨立。',
          qualityDefault: '模型預設',
          qualityUnsupported: '已儲存的品質不再受支援，請選擇其他檔位或恢復模型預設。',
          qualitySavedHint: '對後續圖片請求生效。',
          qualitySaved: '出圖品質已儲存',
          qualityRuntimeUnavailable: '更新執行環境後即可選擇出圖品質，目前品質保持不變。',
          qualityUnavailable: '此模型沒有可調整的品質檔位，將使用模型預設品質。',
          runtimeUnavailable: '目前執行環境不支援 Aino 生圖，請重新啟動或更新。',
          loadFailed: '無法載入生圖設定，請檢查執行環境連線後重試。',
          billingRules: '依生圖計費規則扣費，可在「我的帳戶」查看用量。',
          unavailable: 'Aino 生圖暫不可用，請更新執行環境並確認平台已配置生圖模型。',
          title: '圖片生成',
          description: '使用 Aino 帳戶生成圖片。生圖模型與文字模型分開管理，選擇對新對話生效。',
          qualityLabels: {
            auto: '自動',
            low: '低',
            medium: '中',
            high: '高',
            xhigh: '極高',
            max: '最高'
          }
        }
      }
    },
    shell: {
      statusbar: {
        contextUsagePanel: {
          compactTitle: '上下文視窗'
        }
      }
    }
  }
} satisfies Record<string, TranslationOverrides>
