"""
Shared font calculation utilities for PDF generation.
Ensures consistent font sizing between soft copy and certificate generation.
"""

import fitz


def calculate_optimal_font_size_with_line_breaks(text, rect, fontname, template_type, min_font_size=4, original_font_size=20):
    """
    Enhanced font calculation that finds the minimum font size needed for the longest line,
    then applies that font size to the entire field to respect line break boundaries.
    
    This function ensures consistent font sizing between soft copy and certificate generation
    when line breaks are present.
    
    Args:
        text: The text to render
        rect: The rectangle coordinates for the text
        fontname: The font name to use
        template_type: The template type (affects line height calculation)
        min_font_size: Minimum allowed font size
        original_font_size: Starting font size before optimization
    
    Returns:
        tuple: (final_font_size, lines_list)
    """
    if '\n' not in text and '\r\n' not in text:
        # No line breaks - use standard logic
        return calculate_standard_font_size(text, rect, fontname, template_type, min_font_size, original_font_size)
    
    print(f"🔍 [SHARED OPTIMIZATION] Line breaks detected - finding minimum font size for longest line")
    
    # Split by line breaks
    text_lines = text.split('\n')
    
    # Step 1: Find the minimum font size needed for the LONGEST line
    min_font_for_lines = []
    
    for line_idx, line in enumerate(text_lines):
        if not line.strip():
            min_font_for_lines.append(original_font_size)  # Empty line doesn't need font reduction
            continue
            
        # Find minimum font size for this line
        line_font = original_font_size
        font_obj = fitz.Font(fontname=fontname)
        
        while line_font >= min_font_size:
            line_width = font_obj.text_length(line, fontsize=line_font)
            if line_width <= rect.width:
                break
            line_font -= 0.5
        
        min_font_for_lines.append(max(line_font, min_font_size))
        print(f"🔍 [SHARED OPTIMIZATION] Line {line_idx + 1} needs minimum font: {min_font_for_lines[-1]:.1f}pt for '{line[:30]}...'")
    
    # Use the lowest font size needed for any line
    optimal_font_size = min(min_font_for_lines)
    print(f"🔍 [SHARED OPTIMIZATION] Using lowest font size: {optimal_font_size:.1f}pt for entire field")
    
    # Step 2: Check if all lines fit at this font size
    lines = []
    font_obj = fitz.Font(fontname=fontname)
    
    for line in text_lines:
        if not line.strip():
            lines.append("")
            continue
            
        # Check if line fits as-is at optimal font size
        line_width = font_obj.text_length(line, fontsize=optimal_font_size)
        if line_width <= rect.width:
            lines.append(line)
            print(f"🔍 [SHARED OPTIMIZATION] Line fits as-is at {optimal_font_size:.1f}pt")
        else:
            # Line still too long - need to wrap
            words = line.split()
            wrapped_lines = []
            current_line = ""
            
            for word in words:
                test_line = current_line + (" " if current_line else "") + word
                test_width = font_obj.text_length(test_line, fontsize=optimal_font_size)
                
                if test_width <= rect.width:
                    current_line = test_line
                else:
                    if current_line:
                        wrapped_lines.append(current_line)
                    current_line = word
            
            if current_line:
                wrapped_lines.append(current_line)
            
            lines.extend(wrapped_lines)
    
    # Step 3: Check total height and optimize if needed
    if template_type in ["large", "large_eco", "large_nonaccredited", "large_other", "large_other_eco", "large_other_nonaccredited", "logo", "logo_nonaccredited", "logo_other", "logo_other_nonaccredited"]:
        line_height = optimal_font_size * 1.1
    else:
        line_height = optimal_font_size * 1.2
    
    total_height = len(lines) * line_height
    
    if total_height <= rect.height:
        print(f"✅ [SHARED OPTIMIZATION] All lines fit at {optimal_font_size:.1f}pt")
        return optimal_font_size, lines
    else:
        # Height overflow: search for the largest font size that fits total height with wrapping
        print(f"⚠️ [SHARED OPTIMIZATION] Height overflow at {optimal_font_size:.1f}pt → searching for max font that fits")
        utilization_pct = (total_height / rect.height) * 100.0 if rect.height else 100.0
        
        # Dynamically relax readability floor when utilization is extremely high
        if utilization_pct > 134.8:
            readable_floor = max(min_font_size, 7)
            print(f"🔧 [SHARED OPTIMIZATION] High utilization {utilization_pct:.1f}% → lowering readability floor to {readable_floor}pt")
        else:
            readable_floor = max(min_font_size, 10)  # Default readability floor
            
        low = readable_floor
        high = max(optimal_font_size, readable_floor)
        best_fit_font = readable_floor
        best_fit_lines = lines
        
        while high - low > 0.5:
            mid = (high + low) / 2.0
            # Re-wrap all lines at this candidate font size
            candidate_lines = []
            candidate_total = 0
            font_obj_mid = fitz.Font(fontname=fontname)
            
            for line in text_lines:
                if not line.strip():
                    candidate_lines.append("")
                    continue
                    
                # Check if line fits as-is at this font size
                line_width = font_obj_mid.text_length(line, fontsize=mid)
                if line_width <= rect.width:
                    candidate_lines.append(line)
                else:
                    # Line needs wrapping
                    words = line.split()
                    current_line = ""
                    
                    for word in words:
                        test_line = current_line + (" " if current_line else "") + word
                        test_width = font_obj_mid.text_length(test_line, fontsize=mid)
                        
                        if test_width <= rect.width:
                            current_line = test_line
                        else:
                            if current_line:
                                candidate_lines.append(current_line)
                            current_line = word
                    
                    if current_line:
                        candidate_lines.append(current_line)
            
            # Calculate total height for this candidate
            if template_type in ["large", "large_eco", "large_nonaccredited", "large_other", "large_other_eco", "large_other_nonaccredited", "logo", "logo_nonaccredited", "logo_other", "logo_other_nonaccredited"]:
                candidate_line_height = mid * 1.1
            else:
                candidate_line_height = mid * 1.2
                
            candidate_total = len(candidate_lines) * candidate_line_height
            
            if candidate_total <= rect.height:
                best_fit_font = mid
                best_fit_lines = candidate_lines
                low = mid
            else:
                high = mid
        
        print(f"✅ [SHARED OPTIMIZATION] Selected font {best_fit_font:.1f}pt after height-fit search (min allowed: {readable_floor}pt)")
        return best_fit_font, best_fit_lines


def calculate_standard_font_size(text, rect, fontname, template_type, min_font_size=4, original_font_size=20):
    """
    Standard font calculation for text without line breaks.
    
    Args:
        text: The text to render
        rect: The rectangle coordinates for the text
        fontname: The font name to use
        template_type: The template type (affects line height calculation)
        min_font_size: Minimum allowed font size
        original_font_size: Starting font size before optimization
    
    Returns:
        tuple: (final_font_size, lines_list)
    """
    font_size = original_font_size
    lines = []
    
    while font_size >= min_font_size:
        # Process text with word wrapping
        words = text.split()
        current_lines = []
        current_line = ""
        
        font_obj = fitz.Font(fontname=fontname)
        
        for word in words:
            test_line = current_line + (" " if current_line else "") + word
            test_width = font_obj.text_length(test_line, fontsize=font_size)
            
            if test_width <= rect.width:
                current_line = test_line
            else:
                if current_line:
                    current_lines.append(current_line)
                current_line = word
        
        if current_line:
            current_lines.append(current_line)
        
        # Check if all lines fit in height
        if template_type in ["large", "large_eco", "large_nonaccredited", "large_other", "large_other_eco", "large_other_nonaccredited", "logo", "logo_nonaccredited", "logo_other", "logo_other_nonaccredited"]:
            line_height = font_size * 1.1
        else:
            line_height = font_size * 1.2
            
        total_height = len(current_lines) * line_height
        
        if total_height <= rect.height:
            lines = current_lines
            break
        
        font_size -= 0.5
    
    return font_size, lines

