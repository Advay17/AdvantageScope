import { ensureThemeContrast } from "../shared/Colors";
import {
  SourceListConfig,
  SourceListItemState,
  SourceListOptionValueConfig,
  SourceListState,
  SourceListTypeConfig,
  SourceListTypeMemoryEntry
} from "../shared/SourceListConfig";
import LoggableType from "../shared/log/LoggableType";
import { createUUID } from "../shared/util";

export default class SourceList {
  static promptCallbacks: { [key: string]: (state: SourceListItemState) => void } = {};

  private ITEM_TEMPLATE = document.getElementById("sourceListItemTemplate")?.firstElementChild as HTMLElement;
  private ROOT: HTMLElement;
  private TITLE: HTMLElement;
  private LIST: HTMLElement;
  private HAND_ICON: HTMLImageElement;
  private DRAG_HIGHLIGHT: HTMLElement;

  private stopped = false;
  private config: SourceListConfig;
  private state: SourceListState = [];
  private independentAllowedTypes: Set<string> = new Set(); // Types that are not only children
  private parentKeys: Map<string, string> = new Map(); // Map type key to parent key

  constructor(root: HTMLElement, config: SourceListConfig) {
    this.config = config;
    this.ROOT = root;
    this.ROOT.classList.add("source-list");

    this.TITLE = document.createElement("div");
    this.ROOT.appendChild(this.TITLE);
    this.TITLE.classList.add("title");
    this.TITLE.innerText = config.title;

    this.LIST = document.createElement("div");
    this.ROOT.appendChild(this.LIST);
    this.LIST.classList.add("list");

    this.HAND_ICON = document.createElement("img");
    this.ROOT.appendChild(this.HAND_ICON);
    this.HAND_ICON.classList.add("hand-icon");
    this.HAND_ICON.src = "symbols/rectangle.and.hand.point.up.left.filled.svg";
    this.updateHandIcon();

    this.DRAG_HIGHLIGHT = document.createElement("div");
    this.ROOT.appendChild(this.DRAG_HIGHLIGHT);
    this.DRAG_HIGHLIGHT.classList.add("drag-highlight");
    this.DRAG_HIGHLIGHT.hidden = true;

    // Summarize config
    this.config.types.forEach((typeConfig) => {
      if (typeConfig.childOf === undefined) {
        typeConfig.sourceTypes.forEach((source) => {
          this.independentAllowedTypes.add(source);
        });
      }
      if (typeConfig.parentKey !== undefined) {
        this.parentKeys.set(typeConfig.key, typeConfig.parentKey);
      }
    });

    // Drag handling
    window.addEventListener("drag-update", (event) => {
      this.handleDrag((event as CustomEvent).detail);
    });

    // Periodic method
    let lastIsDark: boolean | null = null;
    let periodic = () => {
      if (this.stopped) return;

      // Update items when theme changes (some icon colors will change)
      let isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      if (isDark !== lastIsDark) {
        lastIsDark = isDark;
        this.updateAllItems();
      }

      // Update value previews
      this.updateAllPreviews();

      window.requestAnimationFrame(periodic);
    };
    window.requestAnimationFrame(periodic);
  }

  setTitle(title: string): void {
    this.TITLE.innerText = title;
  }

  getState(): SourceListState {
    return this.state;
  }

  setState(state: SourceListState) {
    this.clear();
    state.forEach((itemState) => {
      this.addListItem(itemState);
    });
  }

  getActiveFields(): string[] {
    return this.state.map((item) => item.logKey);
  }

  stop() {
    this.stopped = true;
  }

  /** Removes all items in the source list. */
  clear() {
    this.state = [];
    while (this.LIST.firstChild) {
      this.LIST.removeChild(this.LIST.firstChild);
    }
    this.updateHandIcon();
  }

  private updateHandIcon() {
    let show = this.LIST.childElementCount === 0;
    this.HAND_ICON.style.transition = show ? "opacity 1s ease-in 1s" : "";
    this.HAND_ICON.style.opacity = show ? "0.15" : "0";
  }

  /**
   * Adds a new field to the list, if the type is valid.
   *
   * @param logKey The key for the field to add
   * @param parentIndex The index of the parent item (optional)
   */
  addField(logKey: string, parentIndex?: number) {
    let logType = window.log.getType(logKey);
    let logTypeString = logType === null ? null : LoggableType[logType];
    let structuredType = window.log.getStructuredType(logKey);

    // Get memory entry
    let memory: SourceListTypeMemoryEntry | null = null;
    if (
      this.config.typeMemoryId &&
      this.config.typeMemoryId in window.typeMemory &&
      logKey in window.typeMemory[this.config.typeMemoryId]
    ) {
      memory = window.typeMemory[this.config.typeMemoryId][logKey];
    }

    // Get all possible types
    let possibleTypes: { typeConfig: SourceListTypeConfig; logType: string; uses: number }[] = [];
    for (let i = 0; i < this.config.types.length; i++) {
      let typeConfig = this.config.types[i];
      if (
        (parentIndex === undefined && typeConfig.childOf !== undefined) || // Not inserting as a child
        (parentIndex !== undefined && typeConfig.childOf !== this.parentKeys.get(this.state[parentIndex!].type)) // Type is not the correct parent
      ) {
        continue;
      }
      let finalType = "";
      if (structuredType !== null && typeConfig.sourceTypes.includes(structuredType)) {
        finalType = structuredType;
      } else if (logTypeString !== null && typeConfig.sourceTypes.includes(logTypeString)) {
        finalType = logTypeString;
      }
      if (finalType.length > 0) {
        possibleTypes.push({
          typeConfig: typeConfig,
          logType: finalType,
          uses: this.state.filter((itemState) => itemState.type === typeConfig.key).length
        });
      }
    }

    // Find best type
    if (possibleTypes.length === 0) return;
    if (this.config.autoAdvance === true) {
      possibleTypes.sort((a, b) => a.uses - b.uses);
    }
    let memoryTypeIndex = possibleTypes.findIndex((type) => memory !== null && type.typeConfig.key === memory.type);
    if (memoryTypeIndex !== -1) {
      let memoryType = possibleTypes.splice(memoryTypeIndex, 1)[0];
      possibleTypes.splice(0, 0, memoryType);
    }
    let bestType = possibleTypes[0];

    // Add to list
    let options: { [key: string]: string } = {};
    bestType.typeConfig.options.forEach((optionConfig) => {
      if (
        memory !== null &&
        optionConfig.key in memory.options &&
        optionConfig.values.map((valueConfig) => valueConfig.key).includes(memory.options[optionConfig.key])
      ) {
        // Select value from type memory
        options[optionConfig.key] = memory.options[optionConfig.key];
      } else if (this.config.autoAdvance !== optionConfig.key) {
        // Select first value
        options[optionConfig.key] = optionConfig.values[0].key;
      } else {
        // Select least used value
        let useCounts: { valueConfig: SourceListOptionValueConfig; uses: number }[] = optionConfig.values.map(
          (valueConfig) => {
            return {
              valueConfig: valueConfig,
              uses: this.state.filter(
                (itemState) =>
                  optionConfig.key in itemState.options && itemState.options[optionConfig.key] === valueConfig.key
              ).length
            };
          }
        );
        useCounts.sort((a, b) => a.uses - b.uses);
        options[optionConfig.key] = useCounts[0].valueConfig.key;
      }
    });
    let state: SourceListItemState = {
      type: bestType.typeConfig.key,
      logKey: logKey,
      logType: bestType.logType,
      visible: true,
      options: options
    };
    if (parentIndex !== undefined) {
      let insertIndex = parentIndex! + 1;
      while (insertIndex < this.state.length && this.isChild(insertIndex)) {
        insertIndex++;
      }
      this.addListItem(state, insertIndex);
    } else {
      this.addListItem(state);
    }
  }

  /** Processes a drag event, including adding a field if necessary. */
  private handleDrag(dragData: any) {
    let end = dragData.end;
    let x = dragData.x;
    let y = dragData.y;
    let draggedFields: { fields: string[]; children: string[] } = dragData.data;

    // Exit if out of range
    let listRect = this.ROOT.getBoundingClientRect();
    if (listRect.width === 0 || listRect.height === 0) {
      this.DRAG_HIGHLIGHT.hidden = true;
      return;
    }

    // Check pixel ranges
    let withinList = x > listRect.left && x < listRect.right && y > listRect.top && y < listRect.bottom;
    let parentIndex: number | null = null;
    for (let i = 0; i < this.LIST.childElementCount; i++) {
      let itemRect = this.LIST.children[i].getBoundingClientRect();
      let withinItem = x > itemRect.left && x < itemRect.right && y > itemRect.top && y < itemRect.bottom;
      if (withinItem && this.parentKeys.has(this.state[i].type)) {
        parentIndex = i;
      }
    }

    // Check type validity
    let isTypeValid = (sourceTypes: Set<string>): boolean => {
      return draggedFields.fields.some((field) => {
        let logType = window.log.getType(field);
        let logTypeString = logType === null ? null : LoggableType[logType];
        let structuredType = window.log.getStructuredType(field);
        return (
          (logTypeString !== null && sourceTypes.has(logTypeString)) ||
          (structuredType !== null && sourceTypes.has(structuredType))
        );
      });
    };
    let typeValidList = isTypeValid(this.independentAllowedTypes);
    let typeValidParent = false;
    if (parentIndex !== null) {
      let parentKey = this.parentKeys.get(this.state[parentIndex!].type);
      let childAllowedTypes: Set<string> = new Set();
      this.config.types.forEach((typeConfig) => {
        if (typeConfig.childOf === parentKey) {
          typeConfig.sourceTypes.forEach((type) => childAllowedTypes.add(type));
        }
      });
      typeValidParent = isTypeValid(childAllowedTypes);
    }

    // Add fields and update highlight
    if (end) {
      this.DRAG_HIGHLIGHT.hidden = true;
      if (!typeValidParent) parentIndex = null;
      if (parentIndex !== null || (typeValidList && withinList)) {
        draggedFields.fields.forEach((field) => {
          this.addField(field, parentIndex === null ? undefined : parentIndex);
        });
      }
    } else if (typeValidParent && parentIndex !== null) {
      this.DRAG_HIGHLIGHT.style.left = "0%";
      this.DRAG_HIGHLIGHT.style.top =
        (this.LIST.children[parentIndex!].getBoundingClientRect().top - listRect.top).toString() + "px";
      this.DRAG_HIGHLIGHT.style.width = "100%";
      this.DRAG_HIGHLIGHT.style.height = this.LIST.children[parentIndex!].clientHeight.toString() + "px";
      this.DRAG_HIGHLIGHT.hidden = false;
    } else if (typeValidList && withinList) {
      this.DRAG_HIGHLIGHT.style.left = "0%";
      this.DRAG_HIGHLIGHT.style.top = "0%";
      this.DRAG_HIGHLIGHT.style.width = "100%";
      this.DRAG_HIGHLIGHT.style.height = "100%";
      this.DRAG_HIGHLIGHT.hidden = false;
    } else {
      this.DRAG_HIGHLIGHT.hidden = true;
    }
  }

  /** Update all items to match the current state. */
  private updateAllItems() {
    let count = Math.min(this.state.length, this.LIST.childElementCount);
    for (let i = 0; i < count; i++) {
      this.updateItem(this.LIST.children[i] as HTMLElement, this.state[i]);
    }
  }

  /** Update the preview values of all items. */
  private updateAllPreviews() {
    let count = Math.min(this.state.length, this.LIST.childElementCount);
    for (let i = 0; i < count; i++) {
      this.updatePreview(this.LIST.children[i] as HTMLElement, this.state[i]);
    }
  }

  /** Make a list item and inserts it into the list. */
  private addListItem(state: SourceListItemState, insertIndex?: number) {
    let item = this.ITEM_TEMPLATE.cloneNode(true) as HTMLElement;
    if (insertIndex === undefined) {
      this.LIST.appendChild(item);
      this.state.push(state);
    } else {
      this.LIST.insertBefore(item, this.LIST.children[insertIndex!]);
      this.state.splice(insertIndex, 0, state);
    }
    this.updateItem(item, state);
    this.updateHandIcon();

    // Check if child type
    let typeConfig = this.config.types.find((typeConfig) => typeConfig.key === state.type);
    let isChild = typeConfig !== undefined && typeConfig.childOf !== undefined;

    // Type controls
    let typeButton = item.getElementsByClassName("type")[0] as HTMLButtonElement;
    let promptType = (coordinates: [number, number]) => {
      const uuid = createUUID();
      let index = Array.from(this.LIST.children).indexOf(item);
      window.sendMainMessage("source-list-type-prompt", {
        uuid: uuid,
        config: this.config,
        state: this.state[index],
        coordinates: coordinates
      });
      let originalType = this.state[index].type;
      SourceList.promptCallbacks[uuid] = (newState) => {
        delete SourceList.promptCallbacks[uuid];
        let index = Array.from(this.LIST.children).indexOf(item);
        this.state[index] = newState;
        this.updateItem(item, newState);

        if (!isChild) {
          let originalParentKey = this.config.types.find((typeConfig) => typeConfig.key === originalType)?.parentKey;
          let newParentKey = this.config.types.find((typeConfig) => typeConfig.key === newState.type)?.parentKey;
          if (originalParentKey !== newParentKey) {
            // Changed parent key, remove children
            index++;
            if (!this.isChild(index)) return;
            let childCount = 0;
            while (index + childCount < this.state.length) {
              childCount++;
              if (!this.isChild(index + childCount)) break;
            }
            this.state.splice(index, childCount);
            for (let i = 0; i < childCount; i++) {
              this.LIST.removeChild(this.LIST.children[index]);
              this.updateHandIcon();
            }
          }
        }
      };
    };
    typeButton.addEventListener("click", () => {
      let rect = typeButton.getBoundingClientRect();
      promptType([Math.round(rect.right), Math.round(rect.top)]);
    });
    item.addEventListener("contextmenu", (event) => {
      promptType([event.clientX, event.clientY]);
    });

    // Warning button
    let warningButton = item.getElementsByClassName("warning")[0] as HTMLButtonElement;
    let enableWarning = typeConfig?.numberArrayDeprecated === true && state.logType === "NumberArray";
    warningButton.hidden = !enableWarning;
    let keyContainer = item.getElementsByClassName("key-container")[0] as HTMLElement;
    keyContainer.style.setProperty("--has-warning", enableWarning ? "1" : "0");
    warningButton.addEventListener("click", () => {
      window.sendMainMessage("numeric-array-deprecation-warning", { force: true });
    });
    if (enableWarning) {
      window.sendMainMessage("numeric-array-deprecation-warning", { force: false });
    }

    // Hide button
    let hideButton = item.getElementsByClassName("hide")[0] as HTMLButtonElement;
    let toggleHidden = () => {
      if (isChild) return;
      let index = Array.from(this.LIST.children).indexOf(item);
      let newVisible = !this.state[index].visible;
      this.state[index].visible = newVisible;
      this.updateItem(item, this.state[index]);
      while (index < this.state.length) {
        index++;
        if (!this.isChild(index)) break;
        this.state[index].visible = newVisible;
        this.updateItem(this.LIST.children[index] as HTMLElement, this.state[index]);
      }
    };
    hideButton.addEventListener("click", (event) => {
      event.preventDefault();
      toggleHidden();
    });
    let lastClick = 0;
    item.addEventListener("click", () => {
      let now = new Date().getTime();
      if (now - lastClick < 400) {
        toggleHidden();
        lastClick = 0;
      } else {
        lastClick = now;
      }
    });

    // Child formatting
    if (isChild) {
      hideButton.hidden = true;
      item.classList.add("child");
    }

    // Remove button
    let removeButton = item.getElementsByClassName("remove")[0] as HTMLButtonElement;
    removeButton.addEventListener("click", () => {
      let index = Array.from(this.LIST.children).indexOf(item);
      let removeCount = 0;
      while (index + removeCount < this.state.length) {
        removeCount++;
        if (isChild || !this.isChild(index + removeCount)) break;
      }
      this.state.splice(index, removeCount);
      for (let i = 0; i < removeCount; i++) {
        this.LIST.removeChild(this.LIST.children[index]);
      }
      this.updateHandIcon();
    });
    return item;
  }

  /**
   * Updates a list item to match the item state.
   *
   * @param item The HTML element to update
   * @param state The desired display state
   */
  private updateItem(item: HTMLElement, state: SourceListItemState) {
    let typeConfig = this.config.types.find((typeConfig) => typeConfig.key === state.type);
    if (typeConfig === undefined) throw 'Unknown type "' + state.type + '"';

    // Update type icon
    let typeIconVisible = item.getElementsByTagName("object")[0] as HTMLObjectElement;
    let typeIconHidden = item.getElementsByTagName("object")[1] as HTMLObjectElement;
    if (typeIconVisible.classList.contains("hidden")) {
      let temp = typeIconVisible;
      typeIconVisible = typeIconHidden;
      typeIconHidden = temp;
    }
    let color: string;
    if (typeConfig.color.startsWith("#")) {
      const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      if (isDark && typeConfig.darkColor !== undefined) {
        color = typeConfig.darkColor;
      } else {
        color = typeConfig.color;
      }
    } else {
      color = state.options[typeConfig.color];
    }
    color = ensureThemeContrast(color);
    let dataPath = "symbols/sourceList/" + typeConfig.symbol + ".svg";
    if (dataPath !== typeIconVisible.getAttribute("data")) {
      // Load new icon on hidden icon
      typeIconHidden.data = dataPath;
      typeIconHidden.addEventListener("load", () => {
        if (typeIconHidden.contentDocument) {
          typeIconHidden.contentDocument.getElementsByTagName("svg")[0].style.color = color;
          typeIconHidden.classList.remove("hidden");
          typeIconVisible.classList.add("hidden");
        }
      });
    } else if (typeIconVisible.contentDocument !== null) {
      // Replace color on visible icon
      let svgs = typeIconVisible.contentDocument.getElementsByTagName("svg");
      if (svgs.length > 0) {
        svgs[0].style.color = color;
      }
    }

    // Update type name
    let typeNameComponents: string[] = [];
    if (typeConfig.showInTypeName) {
      typeNameComponents.push(typeConfig.display);
    }
    typeConfig.options.forEach((optionConfig) => {
      if (optionConfig.showInTypeName) {
        let valueKey = state.options[optionConfig.key];
        let valueConfig = optionConfig.values.find((value) => value.key === valueKey);
        if (valueConfig === undefined) return;
        typeNameComponents.push(valueConfig.display);
      }
    });
    let typeNameElement = item.getElementsByClassName("type-name")[0] as HTMLElement;
    typeNameElement.innerText = typeNameComponents.join("/") + ":";

    // Update log key
    let keyContainer = item.getElementsByClassName("key-container")[0] as HTMLElement;
    let keySpan = keyContainer.firstElementChild as HTMLElement;
    keySpan.innerText = state.logKey;
    keyContainer.style.setProperty("--type-width", typeNameElement.clientWidth.toString() + "px");

    // Update hide button
    let hideButton = item.getElementsByClassName("hide")[0] as HTMLButtonElement;
    let hideIcon = hideButton.firstElementChild as HTMLImageElement;
    hideIcon.src = "symbols/" + (state.visible ? "eye.slash.svg" : "eye.svg");
    if (state.visible) {
      item.classList.remove("hidden");
    } else {
      item.classList.add("hidden");
    }

    // Save to memory
    if (this.config.typeMemoryId !== undefined) {
      if (!(this.config.typeMemoryId in window.typeMemory)) {
        window.typeMemory[this.config.typeMemoryId] = {};
      }
      window.typeMemory[this.config.typeMemoryId][state.logKey] = { type: state.type, options: state.options };
    }
  }

  private isChild(index: number) {
    if (index < 0 || index >= this.state.length) return false;
    let typeConfig = this.config.types.find((typeConfig) => typeConfig.key === this.state[index].type);
    return typeConfig !== undefined && typeConfig.childOf !== undefined;
  }

  /**
   * Updates the preview value of an item.
   *
   * @param item The HTML element to update
   * @param state The associated item state
   */
  private updatePreview(item: HTMLElement, state: SourceListItemState) {
    let valueSymbol = item.getElementsByClassName("value-symbol")[0] as HTMLElement;
    let valueText = item.getElementsByClassName("value")[0] as HTMLElement;
    valueSymbol.hidden = true;
    valueText.hidden = true;
    item.style.height = valueSymbol.hidden ? "30px" : "50px";
  }
}
