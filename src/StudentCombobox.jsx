import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Search, X, ChevronDown, Check, AlertCircle, ShieldAlert } from 'lucide-react';
import { filterStudents } from './studentFilter.js';

/**
 * Intelligent Searchable Dropdown / Combobox for selecting students
 */
export default function StudentCombobox({
  students = [],
  value = '',
  onChange,
  disabled = false,
  placeholder = 'Tìm học sinh theo tên, mã hoặc STT...',
  compact = false,
  assignedMap = {}, // Map of studentId -> { batchId, batchLabel }
  currentBatchId = '',
  id,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const itemRefs = useRef([]);

  // Smart dropdown positioning (flip upward if not enough space below)
  useEffect(() => {
    if (isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      if (spaceBelow < 280 && rect.top > 280) {
        setOpenUpward(true);
      } else {
        setOpenUpward(false);
      }
    }
  }, [isOpen]);

  // Find currently selected student
  const selectedStudent = useMemo(() => {
    if (!value) return null;
    return students.find((s) => s.studentId === value) || null;
  }, [students, value]);

  // Check if currently selected student is assigned to another batch
  const currentAssignedToOther = useMemo(() => {
    if (!value || !assignedMap[value]) return null;
    const assignment = assignedMap[value];
    if (assignment.batchId && assignment.batchId !== currentBatchId) {
      return assignment;
    }
    return null;
  }, [value, assignedMap, currentBatchId]);

  // Filter students based on query
  const filteredStudents = useMemo(() => {
    return filterStudents(students, searchQuery);
  }, [students, searchQuery]);

  // Sync input text when selectedStudent changes and menu is closed
  useEffect(() => {
    if (!isOpen) {
      if (selectedStudent) {
        setSearchQuery(`[${selectedStudent.studentId}] ${selectedStudent.name}`);
      } else {
        setSearchQuery('');
      }
    }
  }, [selectedStudent, isOpen]);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
        if (selectedStudent) {
          setSearchQuery(`[${selectedStudent.studentId}] ${selectedStudent.name}`);
        } else {
          setSearchQuery('');
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selectedStudent]);

  // Reset highlight index when filtered list changes
  useEffect(() => {
    setHighlightedIndex(0);
  }, [filteredStudents]);

  // Auto-scroll highlighted option into view
  useEffect(() => {
    if (isOpen && itemRefs.current[highlightedIndex]) {
      itemRefs.current[highlightedIndex].scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
      });
    }
  }, [highlightedIndex, isOpen]);

  function handleSelect(st) {
    if (disabled) return;
    onChange(st ? st.studentId : null);
    setIsOpen(false);
    if (st) {
      setSearchQuery(`[${st.studentId}] ${st.name}`);
    } else {
      setSearchQuery('');
    }
  }

  function handleClear(e) {
    e.stopPropagation();
    if (disabled) return;
    onChange(null);
    setSearchQuery('');
    setIsOpen(false);
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }

  function handleKeyDown(e) {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
        e.preventDefault();
        setIsOpen(true);
        setSearchQuery('');
        return;
      }
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        filteredStudents.length > 0 ? (prev + 1) % filteredStudents.length : 0
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        filteredStudents.length > 0
          ? (prev - 1 + filteredStudents.length) % filteredStudents.length
          : 0
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (isOpen && filteredStudents.length > 0) {
        handleSelect(filteredStudents[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      if (selectedStudent) {
        setSearchQuery(`[${selectedStudent.studentId}] ${selectedStudent.name}`);
      } else {
        setSearchQuery('');
      }
      inputRef.current?.blur();
    }
  }

  function handleFocus() {
    if (disabled) return;
    setIsOpen(true);
    setSearchQuery('');
  }

  return (
    <div
      ref={containerRef}
      className={`student-combobox-root ${compact ? 'combobox-compact' : 'combobox-full'} ${
        disabled ? 'combobox-disabled' : ''
      }`}
      id={id}
    >
      <div
        className={`combobox-control ${isOpen ? 'combobox-control-open' : ''} ${
          currentAssignedToOther ? 'combobox-control-warn' : ''
        }`}
        onClick={() => {
          if (!disabled) {
            setIsOpen((prev) => !prev);
            if (!isOpen) {
              setSearchQuery('');
              inputRef.current?.focus();
            }
          }
        }}
      >
        <span className="combobox-search-icon">
          <Search size={compact ? 13 : 15} />
        </span>

        <input
          ref={inputRef}
          type="text"
          className="combobox-input"
          value={searchQuery}
          disabled={disabled}
          placeholder={
            selectedStudent
              ? `[${selectedStudent.studentId}] ${selectedStudent.name}`
              : placeholder
          }
          onChange={(e) => {
            setSearchQuery(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
        />

        <div className="combobox-actions">
          {value && !disabled && (
            <button
              type="button"
              className="combobox-clear-btn"
              onClick={handleClear}
              title="Xóa ghép học sinh này"
            >
              <X size={compact ? 12 : 14} />
            </button>
          )}

          <span className="combobox-chevron">
            <ChevronDown
              size={compact ? 14 : 16}
              style={{
                transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.15s ease',
              }}
            />
          </span>
        </div>
      </div>

      {/* Warning banner if currently selected student is already assigned to another submission */}
      {currentAssignedToOther && (
        <div className="combobox-duplicate-alert" title={`Đã gán cho bài: ${currentAssignedToOther.batchLabel}`}>
          <AlertCircle size={12} />
          <span>Trùng: Đã gán cho <strong>{currentAssignedToOther.batchLabel}</strong></span>
        </div>
      )}

      {/* Floating Popover Dropdown */}
      {isOpen && !disabled && (
        <div
          className={`combobox-dropdown ${openUpward ? 'combobox-dropdown-upward' : ''}`}
          ref={listRef}
        >
          <div className="combobox-dropdown-header">
            <span>
              Tìm thấy <strong>{filteredStudents.length}</strong> học sinh
            </span>
            {searchQuery && (
              <button
                type="button"
                className="combobox-reset-filter"
                onClick={() => setSearchQuery('')}
              >
                Hiện tất cả
              </button>
            )}
          </div>

          <div className="combobox-options-list">
            {/* Unlink option at top if an option is selected */}
            {value && (
              <div
                className="combobox-option combobox-option-unlink"
                onClick={() => handleSelect(null)}
              >
                <X size={13} />
                <span>— Bỏ ghép (để trống) —</span>
              </div>
            )}

            {filteredStudents.length === 0 ? (
              <div className="combobox-empty">
                <AlertCircle size={16} />
                <p>Không tìm thấy học sinh phù hợp với "{searchQuery}"</p>
                <small>Thử tìm theo tên không dấu, tên riêng, mã số hoặc STT</small>
              </div>
            ) : (
              filteredStudents.map((st, idx) => {
                const isSelected = st.studentId === value;
                const isHighlighted = idx === highlightedIndex;
                const assignment = assignedMap[st.studentId];
                const isAssignedToOther =
                  assignment && assignment.batchId && assignment.batchId !== currentBatchId;

                return (
                  <div
                    key={st.studentId}
                    ref={(el) => (itemRefs.current[idx] = el)}
                    className={`combobox-option ${isSelected ? 'combobox-option-selected' : ''} ${
                      isHighlighted ? 'combobox-option-highlighted' : ''
                    } ${isAssignedToOther ? 'combobox-option-duplicate' : ''}`}
                    onClick={() => handleSelect(st)}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                  >
                    <div className="combobox-option-main">
                      <span className="combobox-option-id">[{st.studentId}]</span>
                      <strong className="combobox-option-name">{st.name}</strong>
                      <span className="combobox-option-stt">STT {st.originalIndex}</span>
                    </div>

                    <div className="combobox-option-meta">
                      {isAssignedToOther && (
                        <span
                          className="combobox-badge-duplicate"
                          title={`Bài nộp: ${assignment.batchLabel}`}
                        >
                          <ShieldAlert size={11} />
                          Đã gán bài khác
                        </span>
                      )}

                      {isSelected && (
                        <span className="combobox-option-check">
                          <Check size={14} />
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
